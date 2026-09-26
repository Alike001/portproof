import { beforeAll, describe, expect, it } from "@jest/globals";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBytes, loadBehaviorContract } from "../src/core/contract.js";
import {
  loadExecutableProofMetadata,
  loadProofArtifact,
  validateArtifactRelationships,
} from "../src/core/executable-proof.js";
import { verify } from "../src/core/verify.js";
import { SemanticBackportAdapter } from "../src/scenarios/semantic-backport.js";
import type { BackportProofReport } from "../src/core/types.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const BOB_CONTRACT = join(REPO_ROOT, "artifacts", "bob", "behavior-contract.candidate.json");
const BOB_METADATA = join(REPO_ROOT, "artifacts", "bob", "executable-proof.json");
const BOB_PROOF = join(
  REPO_ROOT,
  "artifacts",
  "bob",
  "proofs",
  "request-timeout-zero.proof.mjs"
);
const scenario = new SemanticBackportAdapter(REPO_ROOT);

interface ArtifactOverrides {
  contract?: (value: Record<string, unknown>) => void;
  metadata?: (value: Record<string, unknown>) => void;
  proofSource?: string;
  omitProof?: boolean;
}

async function verifyWithArtifactOverrides(
  overrides: ArtifactOverrides
): Promise<BackportProofReport> {
  const tempDir = await mkdtemp(join(REPO_ROOT, ".portproof-test-artifacts-"));
  const contractPath = join(tempDir, "contract.json");
  const metadataPath = join(tempDir, "metadata.json");
  const proofPath = join(tempDir, "proof.mjs");

  const contract = JSON.parse(await readFile(BOB_CONTRACT, "utf8")) as Record<
    string,
    unknown
  >;
  const metadata = JSON.parse(await readFile(BOB_METADATA, "utf8")) as Record<
    string,
    unknown
  >;

  overrides.contract?.(contract);
  metadata.file = relative(REPO_ROOT, proofPath);
  overrides.metadata?.(metadata);

  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (!overrides.omitProof) {
    const proofSource = overrides.proofSource ?? (await readFile(BOB_PROOF, "utf8"));
    await writeFile(proofPath, proofSource, "utf8");
  }

  try {
    return await verify(scenario, {
      fixture: "semantic-backport",
      branch: "demo-proven-backport",
      contractPath,
      proofMetadataPath: metadataPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function verifyBobBranch(branch: string): Promise<BackportProofReport> {
  return verify(scenario, {
    fixture: "semantic-backport",
    branch,
    contractPath: BOB_CONTRACT,
    proofMetadataPath: BOB_METADATA,
  });
}

describe("ExecutableProof metadata", () => {
  it("loads valid Bob metadata and validates its contract relationship", async () => {
    const contract = await loadBehaviorContract(BOB_CONTRACT);
    const metadata = await loadExecutableProofMetadata(BOB_METADATA);
    const artifact = await loadProofArtifact(REPO_ROOT, metadata.file);

    expect(() => {
      validateArtifactRelationships(contract, metadata);
    }).not.toThrow();
    expect(metadata.publicBoundary).toEqual({
      module: "src/request.js",
      export: "createRequestOptions",
    });
    expect(artifact.sourceProofHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a contractId mismatch as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({
      metadata: (metadata) => {
        metadata.contractId = "different-contract";
      },
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("does not match BehaviorContract id");
  });

  it("rejects schema-invalid metadata as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({
      metadata: (metadata) => {
        metadata.undeclaredField = true;
      },
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("schema validation failed");
  });

  it("rejects an expected-value mismatch as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({
      metadata: (metadata) => {
        metadata.expected = { timeout: 1 };
      },
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("expected value does not match");
  });

  it("rejects a missing proof as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({ omitProof: true });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("proof file could not be resolved");
  });

  it("rejects proof path traversal as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({
      metadata: (metadata) => {
        metadata.file = "../outside-portproof-proof.mjs";
      },
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("escapes the repository");
  });
});

describe("JavaScript public-boundary validation", () => {
  it("rejects an __internal import as UNVERIFIABLE", async () => {
    const source = (await readFile(BOB_PROOF, "utf8")).replace(
      "import { createRequestOptions }",
      "import { createRequestOptions, __internal }"
    );
    const report = await verifyWithArtifactOverrides({ proofSource: source });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("forbidden internal helper");
  });

  it("rejects a parseLegacyTimeout import as UNVERIFIABLE", async () => {
    const source = (await readFile(BOB_PROOF, "utf8")).replace(
      "import { createRequestOptions }",
      "import { createRequestOptions, parseLegacyTimeout }"
    );
    const report = await verifyWithArtifactOverrides({ proofSource: source });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("parseLegacyTimeout");
  });

  it("rejects a parseModernTimeout import as UNVERIFIABLE", async () => {
    const source = (await readFile(BOB_PROOF, "utf8")).replace(
      "import { createRequestOptions }",
      "import { createRequestOptions, parseModernTimeout }"
    );
    const report = await verifyWithArtifactOverrides({ proofSource: source });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("parseModernTimeout");
  });

  it("rejects a wrong declared public export as UNVERIFIABLE", async () => {
    const report = await verifyWithArtifactOverrides({
      metadata: (metadata) => {
        metadata.publicBoundary = {
          module: "src/request.js",
          export: "wrongExport",
        };
      },
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("does not statically import");
  });

  it("rejects a public export that is imported but never invoked", async () => {
    const source = (await readFile(BOB_PROOF, "utf8")).replace(
      "const result = createRequestOptions(env);",
      "const result = { timeout: Number(env.REQUEST_TIMEOUT_MS) };"
    );
    const report = await verifyWithArtifactOverrides({ proofSource: source });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("does not invoke declared public export");
  });
});

describe("immutable Bob proof acceptance", () => {
  let cleanReport: BackportProofReport;
  let provenReport: BackportProofReport;
  let sourceHashBefore: string;
  let sourceHashAfter: string;

  beforeAll(async () => {
    sourceHashBefore = hashBytes(await readFile(BOB_PROOF));
    cleanReport = await verifyBobBranch("demo-clean-backport");
    provenReport = await verifyBobBranch("demo-proven-backport");
    sourceHashAfter = hashBytes(await readFile(BOB_PROOF));
  });

  it("uses the exact same Bob proof to reject demo-clean-backport", () => {
    expect(cleanReport.verdict).toBe("NOT_PROVEN");
    expect(cleanReport.semantic.proof.observed).toEqual({ timeout: 5000 });
  });

  it("uses the exact same Bob proof to prove demo-proven-backport", () => {
    expect(provenReport.verdict).toBe("PROVEN");
    expect(provenReport.semantic.proof.observed).toEqual({ timeout: 0 });
  });

  it("reports the same sourceProofHash for both target branches", () => {
    expect(cleanReport.evidence?.executableProof.sourceProofHash).toBe(
      provenReport.evidence?.executableProof.sourceProofHash
    );
    expect(cleanReport.evidence?.executableProof.sourceProofHash).toBe(sourceHashBefore);
  });

  it.each([
    ["clean", () => cleanReport],
    ["proven", () => provenReport],
  ])("keeps copy/pre/post hashes stable for the %s run", (_label, getReport) => {
    const proof = getReport().evidence?.executableProof;
    expect(proof).toBeDefined();
    expect(proof?.copiedProofHash).toBe(proof?.sourceProofHash);
    expect(proof?.preExecutionProofHash).toBe(proof?.sourceProofHash);
    expect(proof?.postExecutionProofHash).toBe(proof?.sourceProofHash);
    expect(proof?.integrityValid).toBe(true);
  });

  it("does not mutate the Bob source proof during either execution", () => {
    expect(sourceHashAfter).toBe(sourceHashBefore);
  });

  it("produces a different SHA-256 when proof bytes are modified", async () => {
    const original = await readFile(BOB_PROOF);
    const modified = Buffer.concat([original, Buffer.from("\n// modified\n", "utf8")]);

    expect(hashBytes(modified)).not.toBe(hashBytes(original));
  });

  it("fails closed if the copied proof mutates itself during execution", async () => {
    const original = await readFile(BOB_PROOF, "utf8");
    const selfMutating = original
      .replace(
        "import assert from 'node:assert/strict';",
        "import assert from 'node:assert/strict';\nimport { appendFileSync } from 'node:fs';"
      )
      .replace(
        "assert.strictEqual(observed, 0, `Expected timeout to be 0, got ${observed}`);",
        "appendFileSync(new URL(import.meta.url), '\\n// mutated during execution\\n');\nassert.strictEqual(observed, 0, `Expected timeout to be 0, got ${observed}`);"
      );

    const report = await verifyWithArtifactOverrides({ proofSource: selfMutating });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("Post-execution proof hash does not match");
    expect(report.evidence?.executableProof.integrityValid).toBe(false);
    expect(report.evidence?.executableProof.postExecutionProofHash).not.toBe(
      report.evidence?.executableProof.sourceProofHash
    );
  });
});
