/**
 * Deterministic ingestion and static validation for Bob-generated proofs.
 *
 * This validates one declared JavaScript/TypeScript static import boundary.
 * It does not claim to establish universal API correctness.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { canonicalSerialize, hashBytes } from "./contract.js";
import type { BehaviorContract, ExecutableProof } from "./types.js";

const nonBlankString = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${field} must be a non-empty string`,
  });

/** Runtime trust boundary for Bob-generated proof metadata. */
export const executableProofSchema: z.ZodType<ExecutableProof> = z.strictObject({
  version: z.literal("1"),
  contractId: nonBlankString("contractId"),
  language: z.literal("javascript"),
  file: nonBlankString("file"),
  publicBoundary: z.strictObject({
    module: nonBlankString("publicBoundary.module"),
    export: nonBlankString("publicBoundary.export"),
  }),
  expected: z.unknown().refine((value) => value !== undefined, {
    message: "expected is required",
  }),
});

export class ExecutableProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutableProofError";
  }
}

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "executableProof";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function loadExecutableProofMetadata(path: string): Promise<ExecutableProof> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ExecutableProofError(
      `Executable proof metadata could not be read at ${path}: ${String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ExecutableProofError(
      `Executable proof metadata contains invalid JSON: ${String(error)}`
    );
  }

  const result = executableProofSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExecutableProofError(
      `Executable proof metadata schema validation failed: ${formatValidationError(result.error)}`
    );
  }

  return result.data;
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

export interface LoadedProofArtifact {
  path: string;
  bytes: Buffer;
  sourceProofHash: string;
}

/** Resolve a metadata-owned proof path without allowing repository escape. */
export async function loadProofArtifact(
  repositoryRoot: string,
  declaredFile: string
): Promise<LoadedProofArtifact> {
  const root = await realpath(repositoryRoot);
  const lexicalPath = resolve(root, declaredFile);

  if (!isInside(root, lexicalPath)) {
    throw new ExecutableProofError(
      `Executable proof path escapes the repository: ${declaredFile}`
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(lexicalPath);
  } catch (error) {
    throw new ExecutableProofError(
      `Executable proof file could not be resolved at ${declaredFile}: ${String(error)}`
    );
  }

  if (!isInside(root, resolvedPath)) {
    throw new ExecutableProofError(
      `Executable proof path resolves outside the repository: ${declaredFile}`
    );
  }

  const bytes = await readFile(resolvedPath);
  return { path: resolvedPath, bytes, sourceProofHash: hashBytes(bytes) };
}

/** Validate deterministic relationships between the two Bob artifacts. */
export function validateArtifactRelationships(
  contract: BehaviorContract,
  metadata: ExecutableProof
): void {
  if (metadata.contractId !== contract.id) {
    throw new ExecutableProofError(
      `Executable proof contractId ${JSON.stringify(metadata.contractId)} does not match BehaviorContract id ${JSON.stringify(contract.id)}`
    );
  }

  if (canonicalSerialize(metadata.expected) !== canonicalSerialize(contract.observable.expected)) {
    throw new ExecutableProofError(
      "Executable proof expected value does not match BehaviorContract observable.expected"
    );
  }
}

const FORBIDDEN_IMPORTS = new Set([
  "__internal",
  "parseLegacyTimeout",
  "parseModernTimeout",
]);

function importedBindings(node: ts.ImportDeclaration): {
  imported: string;
  local: string;
  identifier: ts.Identifier;
}[] {
  const bindings: { imported: string; local: string; identifier: ts.Identifier }[] = [];
  const clause = node.importClause;
  if (!clause) return bindings;

  if (clause.name) {
    bindings.push({
      imported: "default",
      local: clause.name.text,
      identifier: clause.name,
    });
  }

  const namedBindings = clause.namedBindings;
  if (!namedBindings) return bindings;

  if (ts.isNamespaceImport(namedBindings)) {
    bindings.push({
      imported: "*",
      local: namedBindings.name.text,
      identifier: namedBindings.name,
    });
    return bindings;
  }

  for (const element of namedBindings.elements) {
    bindings.push({
      imported: element.propertyName?.text ?? element.name.text,
      local: element.name.text,
      identifier: element.name,
    });
  }

  return bindings;
}

/**
 * Confirm that the proof statically imports and invokes its declared public
 * export from the module path it will resolve to in the isolated target root.
 */
export async function validatePublicBoundary(
  copiedProofPath: string,
  workspaceRoot: string,
  metadata: ExecutableProof
): Promise<void> {
  const program = ts.createProgram({
    rootNames: [copiedProofPath],
    options: {
      allowJs: true,
      checkJs: false,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const sourceFile = program.getSourceFile(copiedProofPath);
  if (!sourceFile) {
    throw new ExecutableProofError("Executable proof could not be parsed");
  }

  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(diagnostics[0]?.messageText ?? "unknown", " ");
    throw new ExecutableProofError(`Executable proof contains invalid syntax: ${message}`);
  }

  const root = resolve(workspaceRoot);
  const declaredModulePath = resolve(root, metadata.publicBoundary.module);
  if (!isInside(root, declaredModulePath)) {
    throw new ExecutableProofError(
      `Declared public boundary module escapes the target root: ${metadata.publicBoundary.module}`
    );
  }

  try {
    const targetStat = await stat(declaredModulePath);
    if (!targetStat.isFile()) {
      throw new Error("not a regular file");
    }
  } catch (error) {
    throw new ExecutableProofError(
      `Declared public boundary module is unavailable in the target: ${String(error)}`
    );
  }

  const localBoundaryNames = new Set<string>();
  const boundarySymbols = new Set<ts.Symbol>();
  const checker = program.getTypeChecker();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const bindings = importedBindings(statement);

    for (const binding of bindings) {
      if (FORBIDDEN_IMPORTS.has(binding.imported) || FORBIDDEN_IMPORTS.has(binding.local)) {
        throw new ExecutableProofError(
          `Executable proof imports forbidden internal helper ${JSON.stringify(binding.imported)}`
        );
      }
    }

    if (specifier.includes("__internal")) {
      throw new ExecutableProofError(
        `Executable proof imports forbidden internal module ${JSON.stringify(specifier)}`
      );
    }

    if (!specifier.startsWith(".")) continue;

    const importedModulePath = resolve(dirname(copiedProofPath), specifier);
    if (importedModulePath !== declaredModulePath) continue;

    for (const binding of bindings) {
      if (binding.imported === metadata.publicBoundary.export) {
        localBoundaryNames.add(binding.local);
        const symbol = checker.getSymbolAtLocation(binding.identifier);
        if (symbol) boundarySymbols.add(symbol);
      }
    }
  }

  if (localBoundaryNames.size === 0) {
    throw new ExecutableProofError(
      `Executable proof does not statically import declared public export ${JSON.stringify(metadata.publicBoundary.export)} from ${JSON.stringify(metadata.publicBoundary.module)}`
    );
  }

  const invokesBoundary = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (
        localBoundaryNames.has(node.expression.text) &&
        symbol !== undefined &&
        boundarySymbols.has(symbol)
      ) {
        return true;
      }
    }

    let childInvokesBoundary = false;
    ts.forEachChild(node, (child) => {
      if (invokesBoundary(child)) childInvokesBoundary = true;
    });
    return childInvokesBoundary;
  };

  if (!invokesBoundary(sourceFile)) {
    throw new ExecutableProofError(
      `Executable proof imports but does not invoke declared public export ${JSON.stringify(metadata.publicBoundary.export)}`
    );
  }
}
