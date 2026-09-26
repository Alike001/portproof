import type { ExecutableProof } from "../core/types.js";

/** Language-specific validation and observation parsing behind the generic core. */
export interface LanguageAdapter {
  readonly id: string;
  validateExecutableProof(
    copiedProofPath: string,
    workspaceRoot: string,
    metadata: ExecutableProof
  ): Promise<void>;
  parseObservation(stdout: string, expected: unknown): unknown;
}
