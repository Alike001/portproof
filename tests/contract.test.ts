import { describe, expect, it } from "@jest/globals";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  behaviorContractSchema,
  hashBehaviorContract,
  hashProofFile,
  loadBehaviorContract,
} from "../src/core/contract.js";
import { createWorkspace, safeCleanup } from "../src/core/fixture.js";
import { SemanticBackportAdapter } from "../src/scenarios/semantic-backport.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const scenario = new SemanticBackportAdapter(REPO_ROOT);

describe("BehaviorContract validation", () => {
  it("loads the valid semantic-backport fixture contract", async () => {
    const contract = await loadBehaviorContract(scenario.contractPath);

    expect(contract.version).toBe("1");
    expect(contract.id).toBe("request-timeout-zero-disables-timeout");
    expect(contract.observable.setup).toEqual({ REQUEST_TIMEOUT_MS: "0" });
    expect(contract.observable.expected).toBe(0);
  });

  it("rejects an empty intent with a human-readable error", async () => {
    const contract = JSON.parse(await readFile(scenario.contractPath, "utf8")) as Record<
      string,
      unknown
    >;
    contract.intent = "";

    await expect(behaviorContractSchema.parseAsync(contract)).rejects.toThrow(
      "intent must be a non-empty string"
    );
  });

  it("rejects a missing expected value", async () => {
    const contract = JSON.parse(await readFile(scenario.contractPath, "utf8")) as {
      observable: Record<string, unknown>;
    };
    delete contract.observable.expected;

    await expect(behaviorContractSchema.parseAsync(contract)).rejects.toThrow(
      "expected is required"
    );
  });

  it("produces a stable contract hash across repeated loads", async () => {
    const first = await loadBehaviorContract(scenario.contractPath);
    const second = await loadBehaviorContract(scenario.contractPath);

    expect(hashBehaviorContract(first)).toBe(hashBehaviorContract(second));
    expect(hashBehaviorContract(first)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("proof file integrity", () => {
  it("produces the same hash for repeated hashing of an unchanged proof", async () => {
    const workspace = await createWorkspace(scenario.bundlePath, "demo-proven-backport");

    try {
      const proofPath = scenario.proofFilePath(workspace.dir);
      const first = await hashProofFile(proofPath);
      const second = await hashProofFile(proofPath);

      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await safeCleanup(workspace.dir);
    }
  });

  it("produces a different hash after the proof bytes are modified", async () => {
    const workspace = await createWorkspace(scenario.bundlePath, "demo-proven-backport");

    try {
      const proofPath = scenario.proofFilePath(workspace.dir);
      const before = await hashProofFile(proofPath);
      await appendFile(proofPath, "\n// integrity test mutation\n", "utf8");
      const after = await hashProofFile(proofPath);

      expect(after).not.toBe(before);
    } finally {
      await safeCleanup(workspace.dir);
    }
  });
});
