import { beforeAll, describe, expect, it } from "@jest/globals";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBytes } from "../src/core/contract.js";
import {
  loadAndValidateRepairPatch,
  loadRepairProposal,
} from "../src/core/repair-artifact.js";
import { verifyRepair } from "../src/core/repair.js";
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
const BOB_PROPOSAL = join(REPO_ROOT, "artifacts", "bob", "repair-proposal.json");
const BOB_PATCH = join(
  REPO_ROOT,
  "artifacts",
  "bob",
  "repairs",
  "request-timeout-zero.patch"
);
const scenario = new SemanticBackportAdapter(REPO_ROOT);

interface RepairOverrides {
  proposal?: (value: Record<string, unknown>) => void;
  metadata?: (value: Record<string, unknown>) => void;
  patchText?: string;
  proofTransform?: (source: string, sourcePath: string) => string;
}

async function verifyWithOverrides(overrides: RepairOverrides): Promise<BackportProofReport> {
  const tempDir = await mkdtemp(join(REPO_ROOT, ".portproof-repair-test-"));
  const contractPath = join(tempDir, "contract.json");
  const metadataPath = join(tempDir, "metadata.json");
  const proofPath = join(tempDir, "proof.mjs");
  const proposalPath = join(tempDir, "proposal.json");
  const patchPath = join(tempDir, "repair.patch");

  try {
    const contractText = await readFile(BOB_CONTRACT, "utf8");
    const metadata = JSON.parse(await readFile(BOB_METADATA, "utf8")) as Record<
      string,
      unknown
    >;
    const proposal = JSON.parse(await readFile(BOB_PROPOSAL, "utf8")) as Record<
      string,
      unknown
    >;
    const originalProof = await readFile(BOB_PROOF, "utf8");

    metadata.file = relative(REPO_ROOT, proofPath);
    overrides.metadata?.(metadata);
    overrides.proposal?.(proposal);

    const proof = overrides.proofTransform?.(originalProof, proofPath) ?? originalProof;
    const patch = overrides.patchText ?? (await readFile(BOB_PATCH, "utf8"));

    await writeFile(contractPath, contractText, "utf8");
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await writeFile(proofPath, proof, "utf8");
    await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
    await writeFile(patchPath, patch, "utf8");

    return await verifyRepair(scenario, {
      fixture: "semantic-backport",
      branch: "demo-clean-backport",
      contractPath,
      proofMetadataPath: metadataPath,
      repairProposalPath: proposalPath,
      patchPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function proposalModifiedPath(path: string): (proposal: Record<string, unknown>) => void {
  return (proposal) => {
    proposal.modifiedPaths = [path];
  };
}

function patchForPath(path: string): string {
  return `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
}

describe("RepairProposal schema and relationships", () => {
  it("loads the valid Bob repair proposal", async () => {
    const proposal = await loadRepairProposal(BOB_PROPOSAL);

    expect(proposal.contractId).toBe("create-request-options-zero-timeout");
    expect(proposal.targetRef).toBe("demo-clean-backport");
    expect(proposal.proofMutationRequired).toBe(false);
    expect(proposal.testMutationRequired).toBe(false);
  });

  it("rejects a contractId mismatch", async () => {
    const report = await verifyWithOverrides({
      proposal: (proposal) => {
        proposal.contractId = "different-contract";
      },
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("does not match BehaviorContract id");
  });

  it("rejects a targetRef mismatch", async () => {
    const report = await verifyWithOverrides({
      proposal: (proposal) => {
        proposal.targetRef = "demo-proven-backport";
      },
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("does not match selected branch");
  });

  it("rejects proofMutationRequired=true", async () => {
    const report = await verifyWithOverrides({
      proposal: (proposal) => {
        proposal.proofMutationRequired = true;
      },
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("proofMutationRequired");
  });

  it("rejects testMutationRequired=true", async () => {
    const report = await verifyWithOverrides({
      proposal: (proposal) => {
        proposal.testMutationRequired = true;
      },
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("testMutationRequired");
  });
});

describe("PortProof-owned patch policy", () => {
  it.each(["tests/request.test.js", "proof/public-behavior-proof.js", "package.json"])(
    "rejects a patch touching %s",
    async (path) => {
      const report = await verifyWithOverrides({
        proposal: proposalModifiedPath(path),
        patchText: patchForPath(path),
      });
      expect(report.verdict).toBe("UNVERIFIABLE");
      expect(report.unverifiableReason).toContain("not exactly authorized by PortProof policy");
    }
  );

  it("rejects path traversal", async () => {
    const report = await verifyWithOverrides({
      proposal: proposalModifiedPath("../src/request.js"),
      patchText: patchForPath("../src/request.js"),
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("unsafe or traversing path");
  });

  it("rejects a rename", async () => {
    const report = await verifyWithOverrides({
      patchText:
        "diff --git a/src/request.js b/src/request-renamed.js\n" +
        "similarity index 100%\n" +
        "rename from src/request.js\n" +
        "rename to src/request-renamed.js\n",
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toMatch(/rename|forbidden metadata/);
  });

  it("rejects a deletion", async () => {
    const report = await verifyWithOverrides({
      patchText:
        "diff --git a/src/request.js b/src/request.js\n" +
        "deleted file mode 100644\n" +
        "--- a/src/request.js\n" +
        "+++ /dev/null\n",
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toMatch(/deleted file mode|creates or deletes/);
  });

  it("rejects a newly created application file", async () => {
    const report = await verifyWithOverrides({
      proposal: proposalModifiedPath("src/new.js"),
      patchText:
        "diff --git a/src/new.js b/src/new.js\n" +
        "new file mode 100644\n" +
        "--- /dev/null\n" +
        "+++ b/src/new.js\n" +
        "@@ -0,0 +1 @@\n" +
        "+export {};\n",
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toMatch(/new file mode|creates or deletes/);
  });

  it("rejects a symbolic-link patch", async () => {
    const report = await verifyWithOverrides({
      patchText:
        "diff --git a/src/request.js b/src/request.js\n" +
        "index 1234567..7654321 120000\n" +
        "--- a/src/request.js\n" +
        "+++ b/src/request.js\n" +
        "@@ -1 +1 @@\n" +
        "-old\n" +
        "+new\n",
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("symbolic link");
  });

  it("rejects a binary patch", async () => {
    const report = await verifyWithOverrides({
      patchText:
        "diff --git a/src/request.js b/src/request.js\n" +
        "GIT binary patch\n" +
        "literal 1\n" +
        "AcmZQz\n",
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("GIT binary patch");
  });

  it("rejects a repairProposal.modifiedPaths mismatch", async () => {
    const report = await verifyWithOverrides({
      proposal: proposalModifiedPath("src/other.js"),
    });
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("do not exactly match");
  });

  it("produces a stable patch hash", async () => {
    const proposal = await loadRepairProposal(BOB_PROPOSAL);
    const first = await loadAndValidateRepairPatch(BOB_PATCH, proposal, scenario.repairPolicy);
    const second = await loadAndValidateRepairPatch(BOB_PATCH, proposal, scenario.repairPolicy);

    expect(first.hash).toBe(second.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("real frozen-proof repair flow", () => {
  let report: BackportProofReport;
  let sourceProofHashBefore: string;
  let sourceProofHashAfter: string;

  beforeAll(async () => {
    sourceProofHashBefore = hashBytes(await readFile(BOB_PROOF));
    report = await verifyRepair(scenario, {
      fixture: "semantic-backport",
      branch: "demo-clean-backport",
      contractPath: BOB_CONTRACT,
      proofMetadataPath: BOB_METADATA,
      repairProposalPath: BOB_PROPOSAL,
      patchPath: BOB_PATCH,
    });
    sourceProofHashAfter = hashBytes(await readFile(BOB_PROOF));
  });

  it("records the before state as NOT_PROVEN with timeout 5000", () => {
    expect(report.repair?.before?.verdict).toBe("NOT_PROVEN");
    expect(report.repair?.before?.observed).toEqual({ timeout: 5000 });
  });

  it("applies the patch to only src/request.js", () => {
    expect(report.repair?.applied).toBe(true);
    expect(report.repair?.policyValid).toBe(true);
    expect(report.repair?.changedPaths).toEqual(["src/request.js"]);
  });

  it("keeps existing tests passing after repair", () => {
    expect(report.repair?.after?.existingTestsPassed).toBe(true);
  });

  it("passes the exact frozen proof after repair", () => {
    expect(report.repair?.after?.proofPassed).toBe(true);
    expect(report.evidence?.executableProof.integrityValid).toBe(true);
  });

  it("records the after state as PROVEN with timeout 0", () => {
    expect(report.repair?.after?.verdict).toBe("PROVEN");
    expect(report.repair?.after?.observed).toEqual({ timeout: 0 });
    expect(report.verdict).toBe("PROVEN");
  });

  it("uses the identical proof hash before and after", () => {
    expect(report.repair?.before?.proofHash).toBe(report.repair?.after?.proofHash);
    expect(report.repair?.before?.proofHash).toBe(sourceProofHashBefore);
    expect(sourceProofHashAfter).toBe(sourceProofHashBefore);
  });

  it("uses the identical contract hash before and after", () => {
    expect(report.repair?.before?.contractHash).toBe(report.repair?.after?.contractHash);
    expect(report.repair?.before?.contractHash).toBe(report.contract?.hash);
  });

  it("records the exact repair patch hash", async () => {
    expect(report.repair?.patchHash).toBe(hashBytes(await readFile(BOB_PATCH)));
  });
});

describe("repair fail-closed behavior", () => {
  it("reports proof tampering between runs as UNVERIFIABLE", async () => {
    const report = await verifyWithOverrides({
      proofTransform: (source, sourcePath) =>
        source
          .replace(
            "import assert from 'node:assert/strict';",
            "import assert from 'node:assert/strict';\nimport { appendFileSync } from 'node:fs';"
          )
          .replace(
            "assert.strictEqual(observed, 0, `Expected timeout to be 0, got ${observed}`);",
            `appendFileSync(${JSON.stringify(sourcePath)}, '\\n// tampered\\n');\nassert.strictEqual(observed, 0, \`Expected timeout to be 0, got \${observed}\`);`
          ),
    });

    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("Source proof changed after the before run");
    expect(report.repair?.after).toBeNull();
  });

  it("does not prove a repair that breaks existing tests", async () => {
    const breakingPatch =
      "--- a/src/request.js\n" +
      "+++ b/src/request.js\n" +
      "@@ -14,7 +14,7 @@\n" +
      " \n" +
      " export function createRequestOptions(env = {}) {\n" +
      "   return {\n" +
      "-    timeout: parseLegacyTimeout(env)\n" +
      "+    timeout: 0\n" +
      "   };\n" +
      " }\n" +
      " \n";
    const report = await verifyWithOverrides({ patchText: breakingPatch });

    expect(report.repair?.after?.existingTestsPassed).toBe(false);
    expect(report.verdict).toBe("NOT_PROVEN");
    expect(report.verdict).not.toBe("PROVEN");
  });
});
