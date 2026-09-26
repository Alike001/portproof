/**
 * Scenario adapter for the semantic-backport fixture.
 *
 * This is the only module that knows:
 *  - the bundle path
 *  - how legacy and Bob proofs encode the observed timeout value
 *
 * The generic verification engine (verify.ts) does NOT contain
 * any fixture-specific logic.
 */

import { join } from "node:path";
import { semanticBackportRepairPolicy } from "./semantic-backport-repair-policy.js";
import type { ScenarioAdapter } from "../core/types.js";

/**
 * Expected legacy output line from the fixture proof script:
 *   Public behavior proof: REQUEST_TIMEOUT_MS=0 => timeout <observed>
 *
 * Bob proof output is mapped to the contract-shaped { timeout: number } value.
 */
const PROOF_OUTPUT_PATTERN = /REQUEST_TIMEOUT_MS=0 => timeout (\d+)/;
const BOB_PROOF_OUTPUT_PATTERN = /PORTPROOF_OBSERVED timeout=(\d+)/;

export class SemanticBackportAdapter implements ScenarioAdapter {
  readonly name = "semantic-backport";
  readonly repairPolicy = semanticBackportRepairPolicy;

  constructor(readonly repositoryRoot: string) {}

  get bundlePath(): string {
    return join(this.repositoryRoot, "fixtures", "semantic-backport-fixture.bundle");
  }

  get contractPath(): string {
    return join(this.repositoryRoot, "fixtures", "contracts", "semantic-backport.json");
  }

  proofFilePath(workspaceDir: string): string {
    return join(workspaceDir, "proof", "public-behavior-proof.js");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  existingTestCommand(_dir: string): { command: string; args: string[] } {
    return { command: "npm", args: ["test"] };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  proofCommand(_dir: string): { command: string; args: string[] } {
    return { command: "node", args: ["proof/public-behavior-proof.js"] };
  }

  /** Parse the fixture's legacy or Bob observation protocol. */
  parseObserved(stdout: string): number | { timeout: number } | null {
    const bobMatch = BOB_PROOF_OUTPUT_PATTERN.exec(stdout);
    if (bobMatch?.[1]) {
      const timeout = parseInt(bobMatch[1], 10);
      return Number.isFinite(timeout) ? { timeout } : null;
    }

    const match = PROOF_OUTPUT_PATTERN.exec(stdout);
    if (!match?.[1]) return null;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
