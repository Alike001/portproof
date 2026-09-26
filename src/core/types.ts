/**
 * Core types for the PortProof deterministic verification engine.
 *
 * Trust boundary principle:
 *   Bob proposes structured evidence.
 *   Deterministic code validates and executes it.
 *   Bob never assigns the final verdict.
 *
 * The deterministic core contains no AI components. Every verdict comes from
 * validated evidence, integrity records, process exit codes, and captured
 * output only.
 */

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/** The three machine-verifiable verdict states. */
export type Verdict = "PROVEN" | "NOT_PROVEN" | "UNVERIFIABLE";

// ---------------------------------------------------------------------------
// Behavior contract and proof integrity
// ---------------------------------------------------------------------------

/** Schema-validated statement of the observable behavior under proof. */
export interface BehaviorContract {
  version: "1";
  id: string;
  intent: string;
  observable: {
    setup: Record<string, string>;
    operation: string;
    expected: unknown;
  };
}

/** SHA-256 fingerprints binding a verification run to its evidence. */
export interface ProofIntegrityRecord {
  contractHash: string;
  proofHash: string;
}

/** Schema-validated metadata describing a Bob-generated JavaScript proof. */
export interface ExecutableProof {
  version: "1";
  contractId: string;
  language: "javascript";
  file: string;
  publicBoundary: {
    module: string;
    export: string;
  };
  expected: unknown;
}

/** Evidence that the exact Bob proof stayed frozen through execution. */
export interface ExecutableProofEvidence {
  file: string;
  publicBoundary: ExecutableProof["publicBoundary"];
  sourceProofHash: string;
  copiedProofHash: string | null;
  preExecutionProofHash: string | null;
  postExecutionProofHash: string | null;
  integrityValid: boolean;
}

// ---------------------------------------------------------------------------
// Process execution result
// ---------------------------------------------------------------------------

/** Raw result of a single child-process invocation. */
export interface ProcessResult {
  /** Command name (no shell interpolation). */
  command: string;
  /** Argument array passed directly to spawn. */
  args: string[];
  /** Process exit code, or null if the process was killed by a signal. */
  exitCode: number | null;
  /** Signal name if the process was killed, otherwise null. */
  signal: string | null;
  /** Captured stdout (UTF-8). */
  stdout: string;
  /** Captured stderr (UTF-8). */
  stderr: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Individual check results
// ---------------------------------------------------------------------------

/** Result of running the target branch's existing test suite. */
export interface ExistingTestsResult {
  command: string;
  args: string[];
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** Result of running the semantic behavior proof. */
export interface SemanticProofResult {
  command: string;
  args: string[];
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  /** The value the contract asserts must hold. */
  expected: unknown;
  /** The value actually observed from the proof output, or null if unparseable. */
  observed: unknown;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Backport Proof Report
// ---------------------------------------------------------------------------

/**
 * The immutable record emitted at the end of a verification run.
 * Assembled entirely by deterministic code from process results.
 */
export interface BackportProofReport {
  /** Unique identifier for this run (timestamp-based slug). */
  runId: string;
  /** Logical fixture name, e.g. "semantic-backport". */
  fixture: string;
  /** Branch verified, e.g. "demo-clean-backport". */
  branch: string;
  /** HEAD commit SHA of the branch at run time. */
  commitSha: string;
  /** ISO-8601 timestamp when verification started. */
  startedAt: string;
  /** ISO-8601 timestamp when verification completed. */
  completedAt: string;

  mechanical: {
    existingTests: ExistingTestsResult;
  };

  semantic: {
    proof: SemanticProofResult;
  };

  /** Present when the behavior contract was loaded and validated. */
  contract?: {
    value: BehaviorContract;
    hash: string;
  };

  /** Present only when both contract and proof fingerprints were created. */
  integrity?: ProofIntegrityRecord;

  /** Validated Bob artifacts and their deterministic integrity evidence. */
  evidence?: {
    contract: {
      id: string;
      hash: string;
    };
    executableProof: ExecutableProofEvidence;
  };

  /** Final deterministic verdict. */
  verdict: Verdict;

  /**
   * Present only when verdict is UNVERIFIABLE.
   * Explains why a verdict could not be reached and what a human might do.
   */
  unverifiableReason?: string;
}

// ---------------------------------------------------------------------------
// Scenario interface
// ---------------------------------------------------------------------------

/**
 * A scenario adapter knows how to run one class of fixture and how to
 * interpret its output. Fixture-specific logic lives here; the generic
 * runner stays clean.
 */
export interface ScenarioAdapter {
  /** Human-readable name, e.g. "semantic-backport". */
  readonly name: string;

  /** Root used to constrain Bob artifact paths. */
  readonly repositoryRoot: string;

  /**
   * Path to the Git bundle file, relative to the repository root.
   * The runner will clone from this bundle into an isolated workspace.
   */
  readonly bundlePath: string;

  /** Path to the fixture-owned behavior contract JSON file. */
  readonly contractPath: string;

  /** Path to the executable proof artifact in the isolated workspace. */
  proofFilePath(workspaceDir: string): string;

  /**
   * Shell-free command + args to run the existing test suite.
   * Evaluated in the cloned workspace directory.
   */
  existingTestCommand(workspaceDir: string): { command: string; args: string[] };

  /**
   * Shell-free command + args to run the semantic behavior proof.
   * Evaluated in the cloned workspace directory.
   */
  proofCommand(workspaceDir: string): { command: string; args: string[] };

  /**
   * Extract the observed value from the proof's stdout.
   * Returns null if the output cannot be reliably parsed.
   */
  parseObserved(stdout: string): unknown;

}

// ---------------------------------------------------------------------------
// Run options (CLI → engine)
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  fixture: string;
  branch: string;
  /** Explicit BehaviorContract candidate path for Bob-artifact verification. */
  contractPath?: string;
  /** Explicit ExecutableProof metadata path for Bob-artifact verification. */
  proofMetadataPath?: string;
  /** When true, skip workspace cleanup after the run (for debugging). */
  keepWorkspace?: boolean;
}
