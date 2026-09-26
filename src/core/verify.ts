/**
 * Generic verification engine.
 *
 * Orchestrates fixture workspace creation, process execution, verdict
 * assignment, and report assembly. Contains no fixture-specific logic
 * and no AI components.
 *
 * Trust boundary:
 *   Every verdict comes from process exit codes only.
 *   Bob never assigns the final verdict.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hashBehaviorContract,
  hashProofFile,
  loadBehaviorContract,
} from "./contract.js";
import {
  loadExecutableProofMetadata,
  loadProofArtifact,
  validateArtifactRelationships,
  validatePublicBoundary,
} from "./executable-proof.js";
import { createWorkspace, safeCleanup, WorkspaceError } from "./fixture.js";
import { runProcess } from "./runner.js";
import { generateRunId } from "./report.js";
import type {
  BackportProofReport,
  BehaviorContract,
  ExecutableProof,
  ExecutableProofEvidence,
  ExistingTestsResult,
  ProofIntegrityRecord,
  ScenarioAdapter,
  SemanticProofResult,
  Verdict,
  VerifyOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Verdict assignment
// ---------------------------------------------------------------------------

/**
 * Assign the final verdict deterministically from gate results.
 *
 * PROVEN:        existing tests passed AND semantic proof passed
 * NOT_PROVEN:    execution completed, existing tests passed,
 *                semantic proof executed but assertion failed
 * UNVERIFIABLE:  infrastructure/setup prevented a meaningful proof
 *                (branch missing, command not found, timeout, etc.)
 */
function assignVerdict(
  existingTests: ExistingTestsResult,
  proof: SemanticProofResult
): { verdict: Verdict; unverifiableReason?: string } {
  // Existing tests failed to execute (signal / null exit code)
  if (existingTests.exitCode === null) {
    return {
      verdict: "UNVERIFIABLE",
      unverifiableReason: `Existing test process did not complete normally (signal: ${existingTests.stderr || "unknown"})`,
    };
  }

  // Proof failed to execute (signal / null exit code, or ENOENT)
  if (proof.exitCode === null) {
    return {
      verdict: "UNVERIFIABLE",
      unverifiableReason: `Semantic proof process did not complete normally (signal: ${proof.stderr || "unknown"})`,
    };
  }

  // Existing tests themselves failed — we cannot conclude anything about semantics
  if (!existingTests.passed) {
    return {
      verdict: "UNVERIFIABLE",
      unverifiableReason:
        "Existing test suite failed, which may indicate an environment or infrastructure problem rather than a semantic backport failure.",
    };
  }

  // Observed value could not be parsed — treat as infrastructure failure
  if (proof.observed === null) {
    return {
      verdict: "UNVERIFIABLE",
      unverifiableReason:
        "Semantic proof exited non-zero but the observed value could not be parsed from stdout. Cannot produce a reliable verdict.",
    };
  }

  // All execution completed cleanly — verdict from proof exit code
  if (proof.passed) {
    return { verdict: "PROVEN" };
  }

  return { verdict: "NOT_PROVEN" };
}

// ---------------------------------------------------------------------------
// Main verify function
// ---------------------------------------------------------------------------

export interface VerifyResult {
  report: BackportProofReport;
  /** Absolute path to the saved report.json, or null if saving failed. */
  reportPath: string | null;
  /** Absolute path to the workspace, present only when keepWorkspace is true. */
  workspaceDir?: string;
}

/**
 * Run a full verification against the given scenario and branch.
 *
 * @param scenario  - Scenario adapter supplying fixture-specific knowledge.
 * @param options   - Branch to verify and run options.
 * @param repoRoot  - Absolute path to the PortProof repository root.
 */
export async function verify(
  scenario: ScenarioAdapter,
  options: VerifyOptions
): Promise<BackportProofReport> {
  const hasContract = options.contractPath !== undefined;
  const hasProofMetadata = options.proofMetadataPath !== undefined;

  if (hasContract !== hasProofMetadata) {
    const startedAt = new Date().toISOString();
    return buildUnverifiableReport({
      runId: generateRunId(),
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason: "Bob-artifact verification requires both contractPath and proofMetadataPath",
    });
  }

  if (options.contractPath !== undefined && options.proofMetadataPath !== undefined) {
    return verifyBobArtifacts(scenario, {
      ...options,
      contractPath: options.contractPath,
      proofMetadataPath: options.proofMetadataPath,
    });
  }

  return verifyLegacy(scenario, options);
}

async function verifyLegacy(
  scenario: ScenarioAdapter,
  options: VerifyOptions
): Promise<BackportProofReport> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  // ------------------------------------------------------------------
  // 1. Validate and fingerprint the fixture-owned behavior contract
  // ------------------------------------------------------------------
  let contract: BehaviorContract;
  let contractHash: string;

  try {
    contract = await loadBehaviorContract(scenario.contractPath);
    contractHash = hashBehaviorContract(contract);
  } catch (error) {
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason: `Behavior contract validation failed: ${String(error)}`,
    });
  }

  const contractArtifact = { value: contract, hash: contractHash };

  // ------------------------------------------------------------------
  // 2. Setup: create isolated workspace
  // ------------------------------------------------------------------
  let workspaceDir: string | undefined;
  let commitSha = "unknown";

  try {
    const workspace = await createWorkspace(scenario.bundlePath, options.branch);
    workspaceDir = workspace.dir;
    commitSha = workspace.commitSha;
  } catch (err) {
    const reason =
      err instanceof WorkspaceError
        ? err.message
        : `Workspace setup failed: ${String(err)}`;

    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason,
      contract: contractArtifact,
      expected: contract.observable.expected,
    });
  }

  // ------------------------------------------------------------------
  // 3. Fingerprint the exact executable proof bytes
  // ------------------------------------------------------------------
  let integrity: ProofIntegrityRecord;

  try {
    const proofHash = await hashProofFile(scenario.proofFilePath(workspaceDir));
    integrity = { contractHash, proofHash };
  } catch (error) {
    if (!options.keepWorkspace) {
      await safeCleanup(workspaceDir);
    }
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha,
      startedAt,
      reason: `Executable proof integrity could not be established: ${String(error)}`,
      contract: contractArtifact,
      expected: contract.observable.expected,
    });
  }

  // ------------------------------------------------------------------
  // 4. Run existing tests
  // ------------------------------------------------------------------
  const { command: testCmd, args: testArgs } =
    scenario.existingTestCommand(workspaceDir);

  const testProc = await runProcess(testCmd, testArgs, { cwd: workspaceDir });

  const existingTests: ExistingTestsResult = {
    command: testCmd,
    args: testArgs,
    exitCode: testProc.exitCode,
    passed: testProc.exitCode === 0,
    durationMs: testProc.durationMs,
    stdout: testProc.stdout,
    stderr: testProc.stderr,
  };

  // ------------------------------------------------------------------
  // 5. Run semantic behavior proof
  // ------------------------------------------------------------------
  const { command: proofCmd, args: proofArgs } =
    scenario.proofCommand(workspaceDir);

  const proofProc = await runProcess(proofCmd, proofArgs, { cwd: workspaceDir });

  const observed = scenario.parseObserved(proofProc.stdout);

  const semanticProof: SemanticProofResult = {
    command: proofCmd,
    args: proofArgs,
    exitCode: proofProc.exitCode,
    passed: proofProc.exitCode === 0,
    durationMs: proofProc.durationMs,
    expected: contract.observable.expected,
    observed,
    stdout: proofProc.stdout,
    stderr: proofProc.stderr,
  };

  // ------------------------------------------------------------------
  // 6. Assign verdict deterministically
  // ------------------------------------------------------------------
  const { verdict, unverifiableReason } = assignVerdict(existingTests, semanticProof);

  // ------------------------------------------------------------------
  // 7. Assemble report
  // ------------------------------------------------------------------
  const completedAt = new Date().toISOString();

  const report: BackportProofReport = {
    runId,
    fixture: scenario.name,
    branch: options.branch,
    commitSha,
    startedAt,
    completedAt,
    mechanical: { existingTests },
    semantic: { proof: semanticProof },
    contract: contractArtifact,
    integrity,
    verdict,
    ...(unverifiableReason !== undefined && { unverifiableReason }),
  };

  // ------------------------------------------------------------------
  // 8. Cleanup workspace
  // ------------------------------------------------------------------
  if (!options.keepWorkspace && workspaceDir) {
    await safeCleanup(workspaceDir);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Bob artifact verification
// ---------------------------------------------------------------------------

const COPIED_PROOF_FILENAME = ".portproof-proof.mjs";

function proofEvidence(
  metadata: ExecutableProof,
  sourceProofHash: string,
  hashes: {
    copied?: string;
    preExecution?: string;
    postExecution?: string;
  }
): ExecutableProofEvidence {
  const copiedProofHash = hashes.copied ?? null;
  const preExecutionProofHash = hashes.preExecution ?? null;
  const postExecutionProofHash = hashes.postExecution ?? null;
  return {
    file: metadata.file,
    publicBoundary: metadata.publicBoundary,
    sourceProofHash,
    copiedProofHash,
    preExecutionProofHash,
    postExecutionProofHash,
    integrityValid:
      copiedProofHash === sourceProofHash &&
      preExecutionProofHash === sourceProofHash &&
      postExecutionProofHash === sourceProofHash,
  };
}

async function verifyBobArtifacts(
  scenario: ScenarioAdapter,
  options: VerifyOptions & { contractPath: string; proofMetadataPath: string }
): Promise<BackportProofReport> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  let contract: BehaviorContract;
  let contractHash: string;
  try {
    contract = await loadBehaviorContract(options.contractPath);
    contractHash = hashBehaviorContract(contract);
  } catch (error) {
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason: `Behavior contract validation failed: ${String(error)}`,
    });
  }

  const contractArtifact = { value: contract, hash: contractHash };

  let metadata: ExecutableProof;
  try {
    metadata = await loadExecutableProofMetadata(options.proofMetadataPath);
    validateArtifactRelationships(contract, metadata);
  } catch (error) {
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason: `Executable proof evidence validation failed: ${String(error)}`,
      contract: contractArtifact,
      expected: contract.observable.expected,
    });
  }

  let sourceProofBytes: Buffer;
  let sourceProofHash: string;
  try {
    const artifact = await loadProofArtifact(scenario.repositoryRoot, metadata.file);
    sourceProofBytes = artifact.bytes;
    sourceProofHash = artifact.sourceProofHash;
  } catch (error) {
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: "unknown",
      startedAt,
      reason: `Executable proof file validation failed: ${String(error)}`,
      contract: contractArtifact,
      expected: contract.observable.expected,
    });
  }

  let workspaceDir: string | undefined;
  let commitSha = "unknown";
  const hashes: {
    copied?: string;
    preExecution?: string;
    postExecution?: string;
  } = {};

  const evidence = () => ({
    contract: { id: contract.id, hash: contractHash },
    executableProof: proofEvidence(metadata, sourceProofHash, hashes),
  });

  const fail = async (
    reason: string,
    existingTests?: ExistingTestsResult,
    semanticProof?: SemanticProofResult
  ): Promise<BackportProofReport> => {
    if (workspaceDir !== undefined && !options.keepWorkspace) {
      await safeCleanup(workspaceDir);
    }
    return buildUnverifiableReport({
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha,
      startedAt,
      reason,
      contract: contractArtifact,
      expected: contract.observable.expected,
      evidence: evidence(),
      ...(existingTests !== undefined && { existingTests }),
      ...(semanticProof !== undefined && { semanticProof }),
    });
  };

  try {
    const workspace = await createWorkspace(scenario.bundlePath, options.branch);
    workspaceDir = workspace.dir;
    commitSha = workspace.commitSha;
  } catch (error) {
    const reason =
      error instanceof WorkspaceError
        ? error.message
        : `Workspace setup failed: ${String(error)}`;
    return fail(reason);
  }

  const copiedProofPath = join(workspaceDir, COPIED_PROOF_FILENAME);
  try {
    await writeFile(copiedProofPath, sourceProofBytes, { flag: "wx" });
    hashes.copied = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(`Executable proof could not be copied without rewriting: ${String(error)}`);
  }

  if (hashes.copied !== sourceProofHash) {
    return fail("Copied executable proof hash does not match the source proof hash");
  }

  try {
    await validatePublicBoundary(copiedProofPath, workspaceDir, metadata);
  } catch (error) {
    return fail(`Executable proof public-boundary validation failed: ${String(error)}`);
  }

  const { command: testCmd, args: testArgs } = scenario.existingTestCommand(workspaceDir);
  const testProc = await runProcess(testCmd, testArgs, { cwd: workspaceDir });
  const existingTests: ExistingTestsResult = {
    command: testCmd,
    args: testArgs,
    exitCode: testProc.exitCode,
    passed: testProc.exitCode === 0,
    durationMs: testProc.durationMs,
    stdout: testProc.stdout,
    stderr: testProc.stderr,
  };

  try {
    hashes.preExecution = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(
      `Executable proof could not be hashed immediately before execution: ${String(error)}`,
      existingTests
    );
  }

  if (hashes.preExecution !== sourceProofHash) {
    return fail("Pre-execution proof hash does not match the source proof hash", existingTests);
  }

  const proofProc = await runProcess("node", [COPIED_PROOF_FILENAME], {
    cwd: workspaceDir,
  });
  const observed = scenario.parseObserved(proofProc.stdout);
  const semanticProof: SemanticProofResult = {
    command: "node",
    args: [COPIED_PROOF_FILENAME],
    exitCode: proofProc.exitCode,
    passed: proofProc.exitCode === 0,
    durationMs: proofProc.durationMs,
    expected: contract.observable.expected,
    observed,
    stdout: proofProc.stdout,
    stderr: proofProc.stderr,
  };

  try {
    hashes.postExecution = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(
      `Executable proof could not be hashed immediately after execution: ${String(error)}`,
      existingTests,
      semanticProof
    );
  }

  if (hashes.postExecution !== sourceProofHash) {
    return fail(
      "Post-execution proof hash does not match the source proof hash",
      existingTests,
      semanticProof
    );
  }

  const { verdict, unverifiableReason } = assignVerdict(existingTests, semanticProof);
  const report: BackportProofReport = {
    runId,
    fixture: scenario.name,
    branch: options.branch,
    commitSha,
    startedAt,
    completedAt: new Date().toISOString(),
    mechanical: { existingTests },
    semantic: { proof: semanticProof },
    contract: contractArtifact,
    integrity: { contractHash, proofHash: sourceProofHash },
    evidence: evidence(),
    verdict,
    ...(unverifiableReason !== undefined && { unverifiableReason }),
  };

  if (!options.keepWorkspace) {
    await safeCleanup(workspaceDir);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Helper: build an UNVERIFIABLE report when setup fails
// ---------------------------------------------------------------------------

interface UnverifiableParams {
  runId: string;
  fixture: string;
  branch: string;
  commitSha: string;
  startedAt: string;
  reason: string;
  contract?: {
    value: BehaviorContract;
    hash: string;
  };
  expected?: unknown;
  evidence?: BackportProofReport["evidence"];
  existingTests?: ExistingTestsResult;
  semanticProof?: SemanticProofResult;
}

function buildUnverifiableReport(params: UnverifiableParams): BackportProofReport {
  const now = new Date().toISOString();
  return {
    runId: params.runId,
    fixture: params.fixture,
    branch: params.branch,
    commitSha: params.commitSha,
    startedAt: params.startedAt,
    completedAt: now,
    mechanical: {
      existingTests: params.existingTests ?? {
        command: "npm",
        args: ["test"],
        exitCode: null,
        passed: false,
        durationMs: 0,
        stdout: "",
        stderr: params.reason,
      },
    },
    semantic: {
      proof: params.semanticProof ?? {
        command: "node",
        args: [],
        exitCode: null,
        passed: false,
        durationMs: 0,
        expected: params.expected ?? null,
        observed: null,
        stdout: "",
        stderr: "",
      },
    },
    ...(params.contract !== undefined && { contract: params.contract }),
    ...(params.evidence !== undefined && { evidence: params.evidence }),
    verdict: "UNVERIFIABLE",
    unverifiableReason: params.reason,
  };
}
