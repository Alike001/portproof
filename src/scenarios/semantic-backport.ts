/**
 * Scenario adapter for the semantic-backport fixture.
 *
 * This is the only module that knows:
 *  - the bundle path
 *  - the expected timeout value (0)
 *  - how to parse the proof's stdout for the observed value
 *
 * The generic verification engine (verify.ts) does NOT contain
 * any fixture-specific logic.
 */

import { join } from "node:path";
import type { ScenarioAdapter } from "../core/types.js";

/**
 * Expected output line from the proof script:
 *   Public behavior proof: REQUEST_TIMEOUT_MS=0 => timeout <observed>
 */
const PROOF_OUTPUT_PATTERN = /REQUEST_TIMEOUT_MS=0 => timeout (\d+)/;

export class SemanticBackportAdapter implements ScenarioAdapter {
  readonly name = "semantic-backport";

  constructor(private readonly repoRoot: string) {}

  get bundlePath(): string {
    return join(this.repoRoot, "fixtures", "semantic-backport-fixture.bundle");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  existingTestCommand(_dir: string): { command: string; args: string[] } {
    return { command: "npm", args: ["test"] };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  proofCommand(_dir: string): { command: string; args: string[] } {
    return { command: "node", args: ["proof/public-behavior-proof.js"] };
  }

  /**
   * Parse the observed timeout value from the proof's stdout.
   * Returns null if the output does not match the expected pattern.
   */
  parseObserved(stdout: string): number | null {
    const match = PROOF_OUTPUT_PATTERN.exec(stdout);
    if (!match?.[1]) return null;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** The behavioral contract asserts that timeout 0 disables the timeout. */
  readonly expectedValue: number = 0;
}
