/** Deterministic schema, relationship, and patch-policy validation for repairs. */

import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";
import { hashBytes } from "./contract.js";
import type { BehaviorContract, RepairPolicy, RepairProposal } from "./types.js";

const nonBlankString = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${field} must be a non-empty string`,
  });

const stringList = (field: string) => z.array(nonBlankString(`${field} entry`));

/** Runtime trust boundary for Bob-generated repair proposals. */
export const repairProposalSchema: z.ZodType<RepairProposal> = z.strictObject({
  version: z.literal("1"),
  contractId: nonBlankString("contractId"),
  targetRef: nonBlankString("targetRef"),
  allowedPaths: stringList("allowedPaths"),
  modifiedPaths: stringList("modifiedPaths"),
  reasoning: nonBlankString("reasoning"),
  expectedEffect: z.strictObject({
    publicApi: nonBlankString("expectedEffect.publicApi"),
    setup: z.record(z.string(), z.string()),
    observable: z.unknown().refine((value) => value !== undefined, {
      message: "expectedEffect.observable is required",
    }),
  }),
  proofMutationRequired: z.literal(false),
  testMutationRequired: z.literal(false),
  uncertainties: stringList("uncertainties"),
});

export class RepairValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairValidationError";
  }
}

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "repairProposal";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function loadRepairProposal(path: string): Promise<RepairProposal> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new RepairValidationError(
      `Repair proposal could not be read at ${path}: ${String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new RepairValidationError(`Repair proposal contains invalid JSON: ${String(error)}`);
  }

  const result = repairProposalSchema.safeParse(parsed);
  if (!result.success) {
    throw new RepairValidationError(
      `Repair proposal schema validation failed: ${formatValidationError(result.error)}`
    );
  }

  return result.data;
}

export function validateRepairRelationships(
  proposal: RepairProposal,
  contract: BehaviorContract,
  selectedBranch: string
): void {
  if (proposal.contractId !== contract.id) {
    throw new RepairValidationError(
      `Repair proposal contractId ${JSON.stringify(proposal.contractId)} does not match BehaviorContract id ${JSON.stringify(contract.id)}`
    );
  }

  if (proposal.targetRef !== selectedBranch) {
    throw new RepairValidationError(
      `Repair proposal targetRef ${JSON.stringify(proposal.targetRef)} does not match selected branch ${JSON.stringify(selectedBranch)}`
    );
  }
}

export interface ParsedRepairPatch {
  bytes: Buffer;
  hash: string;
  changedPaths: string[];
}

function sortedUnique(paths: readonly string[], label: string): string[] {
  const unique = [...new Set(paths)].sort();
  if (unique.length !== paths.length) {
    throw new RepairValidationError(`${label} contains duplicate paths`);
  }
  return unique;
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function validateRepoPath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    posix.isAbsolute(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    posix.normalize(path) !== path
  ) {
    throw new RepairValidationError(`Patch contains unsafe or traversing path: ${path}`);
  }
}

function parseHeaderPath(raw: string, prefix: "a/" | "b/"): string {
  const token = raw.split("\t", 1)[0] ?? "";
  if (token === "/dev/null") {
    throw new RepairValidationError("Patch creates or deletes a file via /dev/null");
  }
  if (token.startsWith('"') || /\s/.test(token) || !token.startsWith(prefix)) {
    throw new RepairValidationError(`Patch path is not an unquoted ${prefix} repository path: ${token}`);
  }
  const path = token.slice(prefix.length);
  validateRepoPath(path);
  return path;
}

function parseChangedPaths(text: string): string[] {
  const forbiddenMarkers = [
    "GIT binary patch",
    "Binary files ",
    "rename from ",
    "rename to ",
    "similarity index ",
    "deleted file mode ",
    "new file mode ",
    "old mode ",
    "new mode ",
  ];

  const changed = new Set<string>();
  let pendingOldPath: string | null = null;
  let hunkCount = 0;

  for (const untrimmedLine of text.split("\n")) {
    const line = untrimmedLine.endsWith("\r") ? untrimmedLine.slice(0, -1) : untrimmedLine;

    if (forbiddenMarkers.some((marker) => line.startsWith(marker))) {
      throw new RepairValidationError(`Patch contains forbidden metadata: ${line}`);
    }
    if (/^index [0-9a-f]+\.\.[0-9a-f]+ 120000$/i.test(line)) {
      throw new RepairValidationError("Patch targets a symbolic link");
    }

    if (line.startsWith("diff --git ")) {
      const fields = line.split(" ");
      if (fields.length !== 4) {
        throw new RepairValidationError(`Patch has unsupported diff header: ${line}`);
      }
      const oldPath = parseHeaderPath(fields[2] ?? "", "a/");
      const newPath = parseHeaderPath(fields[3] ?? "", "b/");
      if (oldPath !== newPath) {
        throw new RepairValidationError("Patch attempts to rename a file");
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      if (pendingOldPath !== null) {
        throw new RepairValidationError("Patch contains an incomplete file header");
      }
      pendingOldPath = parseHeaderPath(line.slice(4), "a/");
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (pendingOldPath === null) {
        throw new RepairValidationError("Patch contains a new-file header without an old path");
      }
      const newPath = parseHeaderPath(line.slice(4), "b/");
      if (pendingOldPath !== newPath) {
        throw new RepairValidationError("Patch attempts to rename a file");
      }
      changed.add(newPath);
      pendingOldPath = null;
      continue;
    }

    if (line.startsWith("@@ ")) hunkCount += 1;
  }

  if (pendingOldPath !== null) {
    throw new RepairValidationError("Patch contains an incomplete file header");
  }
  if (changed.size === 0 || hunkCount === 0) {
    throw new RepairValidationError("Patch does not contain a textual file modification");
  }

  return [...changed].sort();
}

export async function loadAndValidateRepairPatch(
  path: string,
  proposal: RepairProposal,
  policy: RepairPolicy
): Promise<ParsedRepairPatch> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new RepairValidationError(`Repair patch could not be read at ${path}: ${String(error)}`);
  }

  if (!isUtf8(bytes) || bytes.includes(0)) {
    throw new RepairValidationError("Repair patch is binary or is not valid UTF-8 text");
  }

  const changedPaths = parseChangedPaths(bytes.toString("utf8"));
  const proposalPaths = sortedUnique(proposal.modifiedPaths, "repairProposal.modifiedPaths");
  const policyPaths = sortedUnique(policy.allowedPaths, "PortProof repair policy");

  if (!samePaths(changedPaths, proposalPaths)) {
    throw new RepairValidationError(
      `Patch paths ${JSON.stringify(changedPaths)} do not exactly match repairProposal.modifiedPaths ${JSON.stringify(proposalPaths)}`
    );
  }
  if (!samePaths(changedPaths, policyPaths)) {
    throw new RepairValidationError(
      `Patch paths ${JSON.stringify(changedPaths)} are not exactly authorized by PortProof policy ${JSON.stringify(policyPaths)}`
    );
  }

  return { bytes, hash: hashBytes(bytes), changedPaths };
}
