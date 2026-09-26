/** Deterministic Bob repair ingestion and frozen-proof reverification. */

import { lstat, rm, writeFile } from "node:fs/promises";
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
import {
  loadAndValidateRepairPatch,
  loadRepairProposal,
  validateRepairRelationships,
} from "./repair-artifact.js";
import { generateRunId } from "./report.js";
import { runProcess } from "./runner.js";
import type {
  BackportProofReport,
  BehaviorContract,
  ExecutableProof,
  ExecutableProofEvidence,
  ExistingTestsResult,
  ProcessResult,
  RepairProposal,
  RepairStageRecord,
  RepairVerifyOptions,
  ScenarioAdapter,
  SemanticProofResult,
  Verdict,
} from "./types.js";

const COPIED_PROOF_FILENAME = ".portproof-proof.mjs";

interface FrozenProofStage {
  existingTests: ExistingTestsResult;
  semanticProof: SemanticProofResult;
  evidence: ExecutableProofEvidence;
  record: RepairStageRecord;
}

interface StageHashes {
  copiedProofHash: string;
  preExecutionProofHash: string;
  postExecutionProofHash: string;
}

async function requireRegularProofCopy(path: string): Promise<void> {
  const proofStat = await lstat(path);
  if (proofStat.isSymbolicLink() || !proofStat.isFile()) {
    throw new RepairExecutionError("Frozen proof copy is not a regular file");
  }
}

class RepairExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairExecutionError";
  }
}

function processFailure(label: string, result: ProcessResult): RepairExecutionError {
  return new RepairExecutionError(
    `${label} failed (exit ${String(result.exitCode)}): ${result.stderr || result.stdout || "unknown error"}`
  );
}

function evaluateStage(
  existingTests: ExistingTestsResult,
  proof: SemanticProofResult,
  existingTestFailureVerdict: Verdict
): Verdict {
  if (existingTests.exitCode === null || proof.exitCode === null) {
    return "UNVERIFIABLE";
  }
  if (!existingTests.passed) return existingTestFailureVerdict;
  if (proof.observed === null) return "UNVERIFIABLE";
  return proof.passed ? "PROVEN" : "NOT_PROVEN";
}

function buildProofEvidence(
  metadata: ExecutableProof,
  sourceProofHash: string,
  hashes: StageHashes
): ExecutableProofEvidence {
  return {
    file: metadata.file,
    publicBoundary: metadata.publicBoundary,
    sourceProofHash,
    copiedProofHash: hashes.copiedProofHash,
    preExecutionProofHash: hashes.preExecutionProofHash,
    postExecutionProofHash: hashes.postExecutionProofHash,
    integrityValid:
      hashes.copiedProofHash === sourceProofHash &&
      hashes.preExecutionProofHash === sourceProofHash &&
      hashes.postExecutionProofHash === sourceProofHash,
  };
}

async function runFrozenProofStage(params: {
  scenario: ScenarioAdapter;
  workspaceDir: string;
  contract: BehaviorContract;
  contractHash: string;
  metadata: ExecutableProof;
  sourceProofBytes: Buffer;
  sourceProofHash: string;
  existingTestFailureVerdict: Verdict;
}): Promise<FrozenProofStage> {
  const copiedProofPath = join(params.workspaceDir, COPIED_PROOF_FILENAME);
  let copiedProofHash = "";
  let preExecutionProofHash = "";
  let postExecutionProofHash = "";

  try {
    await writeFile(copiedProofPath, params.sourceProofBytes, { flag: "wx" });
    await requireRegularProofCopy(copiedProofPath);
    copiedProofHash = await hashProofFile(copiedProofPath);
    if (copiedProofHash !== params.sourceProofHash) {
      throw new RepairExecutionError("Copied proof hash does not match frozen source proof hash");
    }

    await validatePublicBoundary(copiedProofPath, params.workspaceDir, params.metadata);

    const { command: testCommand, args: testArgs } =
      params.scenario.existingTestCommand(params.workspaceDir);
    const testProcess = await runProcess(testCommand, testArgs, {
      cwd: params.workspaceDir,
    });
    const existingTests: ExistingTestsResult = {
      command: testCommand,
      args: testArgs,
      exitCode: testProcess.exitCode,
      passed: testProcess.exitCode === 0,
      durationMs: testProcess.durationMs,
      stdout: testProcess.stdout,
      stderr: testProcess.stderr,
    };

    await requireRegularProofCopy(copiedProofPath);
    preExecutionProofHash = await hashProofFile(copiedProofPath);
    if (preExecutionProofHash !== params.sourceProofHash) {
      throw new RepairExecutionError(
        "Pre-execution proof hash does not match frozen source proof hash"
      );
    }

    const proofProcess = await runProcess("node", [COPIED_PROOF_FILENAME], {
      cwd: params.workspaceDir,
    });
    const semanticProof: SemanticProofResult = {
      command: "node",
      args: [COPIED_PROOF_FILENAME],
      exitCode: proofProcess.exitCode,
      passed: proofProcess.exitCode === 0,
      durationMs: proofProcess.durationMs,
      expected: params.contract.observable.expected,
      observed: params.scenario.parseObserved(proofProcess.stdout),
      stdout: proofProcess.stdout,
      stderr: proofProcess.stderr,
    };

    await requireRegularProofCopy(copiedProofPath);
    postExecutionProofHash = await hashProofFile(copiedProofPath);
    if (postExecutionProofHash !== params.sourceProofHash) {
      throw new RepairExecutionError(
        "Post-execution proof hash does not match frozen source proof hash"
      );
    }

    const hashes = {
      copiedProofHash,
      preExecutionProofHash,
      postExecutionProofHash,
    };
    const evidence = buildProofEvidence(params.metadata, params.sourceProofHash, hashes);
    const verdict = evaluateStage(
      existingTests,
      semanticProof,
      params.existingTestFailureVerdict
    );

    return {
      existingTests,
      semanticProof,
      evidence,
      record: {
        verdict,
        existingTestsPassed: existingTests.passed,
        proofPassed: semanticProof.passed,
        expected: semanticProof.expected,
        observed: semanticProof.observed,
        proofHash: params.sourceProofHash,
        contractHash: params.contractHash,
      },
    };
  } finally {
    await rm(copiedProofPath, { force: true });
  }
}

async function requireGitSuccess(
  label: string,
  args: string[],
  workspaceDir: string,
  stdin?: Uint8Array
): Promise<ProcessResult> {
  const result = await runProcess("git", args, {
    cwd: workspaceDir,
    ...(stdin !== undefined && { stdin }),
  });
  if (result.exitCode !== 0) throw processFailure(label, result);
  return result;
}

async function requireCleanWorkspace(workspaceDir: string, label: string): Promise<void> {
  const status = await requireGitSuccess(
    `${label} git status`,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    workspaceDir
  );
  if (status.stdout.length > 0) {
    throw new RepairExecutionError(`${label} workspace is not clean: ${status.stdout}`);
  }
}

async function requireRegularFiles(workspaceDir: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    let fileStat;
    try {
      fileStat = await lstat(join(workspaceDir, path));
    } catch (error) {
      throw new RepairExecutionError(
        `Repair path must already exist as an application file: ${path}: ${String(error)}`
      );
    }
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new RepairExecutionError(`Repair path is not a regular application file: ${path}`);
    }
  }
}

function parseChangedPathOutput(stdout: string): string[] {
  const paths = stdout
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .sort();
  return [...new Set(paths)];
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function emptyExistingTests(reason: string): ExistingTestsResult {
  return {
    command: "npm",
    args: ["test"],
    exitCode: null,
    passed: false,
    durationMs: 0,
    stdout: "",
    stderr: reason,
  };
}

function emptySemanticProof(expected: unknown): SemanticProofResult {
  return {
    command: "node",
    args: [COPIED_PROOF_FILENAME],
    exitCode: null,
    passed: false,
    durationMs: 0,
    expected,
    observed: null,
    stdout: "",
    stderr: "",
  };
}

export async function verifyRepair(
  scenario: ScenarioAdapter,
  options: RepairVerifyOptions
): Promise<BackportProofReport> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  let contract: BehaviorContract | undefined;
  let contractHash: string | null = null;
  let metadata: ExecutableProof | undefined;
  let proposal: RepairProposal | undefined;
  let sourceProofBytes: Buffer | undefined;
  let sourceProofHash: string | null = null;
  let sourceProofPath: string | null = null;
  let patchBytes: Buffer | undefined;
  let patchHash: string | null = null;
  let workspaceDir: string | undefined;
  let baseCommitSha: string | null = null;
  let policyValid = false;
  let applied = false;
  let changedPaths: string[] = [];
  let beforeStage: FrozenProofStage | undefined;
  let afterStage: FrozenProofStage | undefined;

  const finalize = async (
    verdict: Verdict,
    reason?: string
  ): Promise<BackportProofReport> => {
    if (workspaceDir !== undefined && !options.keepWorkspace) {
      await safeCleanup(workspaceDir);
    }

    const expected = contract?.observable.expected ?? null;
    const currentStage = afterStage ?? beforeStage;
    const report: BackportProofReport = {
      runId,
      fixture: scenario.name,
      branch: options.branch,
      commitSha: baseCommitSha ?? "unknown",
      startedAt,
      completedAt: new Date().toISOString(),
      mechanical: {
        existingTests: currentStage?.existingTests ?? emptyExistingTests(reason ?? "unavailable"),
      },
      semantic: {
        proof: currentStage?.semanticProof ?? emptySemanticProof(expected),
      },
      ...(contract !== undefined && contractHash !== null && {
        contract: { value: contract, hash: contractHash },
      }),
      ...(contractHash !== null && sourceProofHash !== null && {
        integrity: { contractHash, proofHash: sourceProofHash },
      }),
      ...(metadata !== undefined && contract !== undefined && contractHash !== null &&
        sourceProofHash !== null && currentStage !== undefined && {
          evidence: {
            contract: { id: contract.id, hash: contractHash },
            executableProof: currentStage.evidence,
          },
        }),
      repair: {
        proposal:
          proposal === undefined
            ? null
            : {
                contractId: proposal.contractId,
                targetRef: proposal.targetRef,
                modifiedPaths: proposal.modifiedPaths,
              },
        patchHash,
        baseCommitSha,
        applied,
        policyValid,
        changedPaths,
        before: beforeStage?.record ?? null,
        after: afterStage?.record ?? null,
      },
      verdict,
      ...(verdict === "UNVERIFIABLE" && { unverifiableReason: reason ?? "unknown failure" }),
    };
    return report;
  };

  try {
    contract = await loadBehaviorContract(options.contractPath);
    contractHash = hashBehaviorContract(contract);

    metadata = await loadExecutableProofMetadata(options.proofMetadataPath);
    validateArtifactRelationships(contract, metadata);

    const proofArtifact = await loadProofArtifact(scenario.repositoryRoot, metadata.file);
    sourceProofBytes = proofArtifact.bytes;
    sourceProofHash = proofArtifact.sourceProofHash;
    sourceProofPath = proofArtifact.path;

    proposal = await loadRepairProposal(options.repairProposalPath);
    validateRepairRelationships(proposal, contract, options.branch);

    const patch = await loadAndValidateRepairPatch(
      options.patchPath,
      proposal,
      scenario.repairPolicy
    );
    patchBytes = patch.bytes;
    patchHash = patch.hash;
    changedPaths = patch.changedPaths;
  } catch (error) {
    return finalize("UNVERIFIABLE", `Repair evidence validation failed: ${String(error)}`);
  }

  try {
    const workspace = await createWorkspace(scenario.bundlePath, options.branch);
    workspaceDir = workspace.dir;
    baseCommitSha = workspace.commitSha;

    const head = await requireGitSuccess(
      "Base commit verification",
      ["rev-parse", "HEAD"],
      workspaceDir
    );
    if (head.stdout.trim() !== baseCommitSha) {
      throw new RepairExecutionError("Fresh checkout HEAD does not match captured base commit");
    }
    await requireCleanWorkspace(workspaceDir, "Initial");

    beforeStage = await runFrozenProofStage({
      scenario,
      workspaceDir,
      contract,
      contractHash,
      metadata,
      sourceProofBytes,
      sourceProofHash,
      existingTestFailureVerdict: "UNVERIFIABLE",
    });
    if (beforeStage.record.verdict !== "NOT_PROVEN") {
      throw new RepairExecutionError(
        `Repair requires an initial NOT_PROVEN state, received ${beforeStage.record.verdict}`
      );
    }

    const contractBeforeApply = hashBehaviorContract(
      await loadBehaviorContract(options.contractPath)
    );
    if (contractBeforeApply !== contractHash) {
      throw new RepairExecutionError("BehaviorContract changed after the before run");
    }
    if ((await hashProofFile(sourceProofPath)) !== sourceProofHash) {
      throw new RepairExecutionError("Source proof changed after the before run");
    }
    await requireCleanWorkspace(workspaceDir, "Pre-apply");
    await requireRegularFiles(workspaceDir, changedPaths);

    await requireGitSuccess(
      "git apply --check",
      ["apply", "--check", "--whitespace=error-all", "-"],
      workspaceDir,
      patchBytes
    );
    policyValid = true;
    await requireGitSuccess(
      "git apply",
      ["apply", "--whitespace=error-all", "-"],
      workspaceDir,
      patchBytes
    );
    applied = true;

    const diffNames = await requireGitSuccess(
      "Post-apply changed path inspection",
      ["diff", "--name-only", "--"],
      workspaceDir
    );
    const actualChangedPaths = parseChangedPathOutput(diffNames.stdout);
    const expectedChangedPaths = [...changedPaths].sort();
    if (!samePaths(actualChangedPaths, expectedChangedPaths)) {
      throw new RepairExecutionError(
        `Applied paths ${JSON.stringify(actualChangedPaths)} do not match validated patch paths ${JSON.stringify(expectedChangedPaths)}`
      );
    }
    changedPaths = actualChangedPaths;

    const proposalPaths = [...proposal.modifiedPaths].sort();
    const policyPaths = [...scenario.repairPolicy.allowedPaths].sort();
    if (!samePaths(changedPaths, proposalPaths) || !samePaths(changedPaths, policyPaths)) {
      throw new RepairExecutionError("Applied paths do not match proposal and PortProof policy");
    }

    await requireRegularFiles(workspaceDir, changedPaths);
    await requireGitSuccess("Post-apply diff validation", ["diff", "--check"], workspaceDir);

    const status = await requireGitSuccess(
      "Post-apply git status",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      workspaceDir
    );
    const statusPaths = status.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3))
      .sort();
    if (!samePaths(statusPaths, changedPaths)) {
      throw new RepairExecutionError(
        `Working tree status paths ${JSON.stringify(statusPaths)} do not match approved paths ${JSON.stringify(changedPaths)}`
      );
    }

    const contractBeforeAfter = hashBehaviorContract(
      await loadBehaviorContract(options.contractPath)
    );
    if (contractBeforeAfter !== contractHash) {
      throw new RepairExecutionError("BehaviorContract changed before repair reverification");
    }
    if ((await hashProofFile(sourceProofPath)) !== sourceProofHash) {
      throw new RepairExecutionError("Source proof changed before repair reverification");
    }

    const diffBeforeAfter = await requireGitSuccess(
      "Pre-reverification diff capture",
      ["diff", "--binary", "--"],
      workspaceDir
    );

    afterStage = await runFrozenProofStage({
      scenario,
      workspaceDir,
      contract,
      contractHash,
      metadata,
      sourceProofBytes,
      sourceProofHash,
      existingTestFailureVerdict: "NOT_PROVEN",
    });

    const diffAfterAfter = await requireGitSuccess(
      "Post-reverification diff capture",
      ["diff", "--binary", "--"],
      workspaceDir
    );
    if (diffAfterAfter.stdout !== diffBeforeAfter.stdout) {
      throw new RepairExecutionError(
        "Target application diff changed during tests or proof execution"
      );
    }

    if (hashBehaviorContract(await loadBehaviorContract(options.contractPath)) !== contractHash) {
      throw new RepairExecutionError("BehaviorContract changed during repair reverification");
    }
    if ((await hashProofFile(sourceProofPath)) !== sourceProofHash) {
      throw new RepairExecutionError("Source proof changed during repair reverification");
    }

    if (afterStage.record.verdict === "UNVERIFIABLE") {
      throw new RepairExecutionError(
        "After-repair tests or proof did not produce a meaningful execution result"
      );
    }

    return await finalize(afterStage.record.verdict);
  } catch (error) {
    const reason =
      error instanceof WorkspaceError
        ? error.message
        : `Repair verification failed: ${String(error)}`;
    return finalize("UNVERIFIABLE", reason);
  }
}
