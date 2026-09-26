import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getLanguageAdapter } from "../adapters/index.js";
import { canonicalSerialize, hashBehaviorContract, hashProofFile, loadBehaviorContract } from "./contract.js";
import {
  loadExecutableProofMetadata,
  loadProofArtifact,
  validateArtifactRelationships,
} from "./executable-proof.js";
import { safeCleanup } from "./fixture.js";
import { loadProjectConfig } from "./project-config.js";
import { prepareRepository } from "./preparation.js";
import { createRepositoryWorkspace, inspectRepository } from "./repository.js";
import { generateRunId } from "./report.js";
import { runProcess } from "./runner.js";
import type {
  BackportProofReport,
  BehaviorContract,
  ExecutableProof,
  ExecutableProofEvidence,
  ExistingTestsResult,
  PortProofProjectConfig,
  PreparationResult,
  RepositoryProvenance,
  SemanticProofResult,
  VerifyRepositoryOptions,
  WorkspaceStatusResult,
} from "./types.js";

const COPIED_PROOF_FILENAME = ".portproof-proof.mjs";

function safeError(error: unknown, replacements: readonly [string, string][]): string {
  let message = String(error);
  for (const [sensitivePath, label] of replacements) {
    if (sensitivePath) message = message.replaceAll(sensitivePath, label);
  }
  return message;
}

interface HashLifecycle {
  copied?: string;
  preExecution?: string;
  postExecution?: string;
}

function proofEvidence(
  metadata: ExecutableProof,
  sourceProofHash: string,
  hashes: HashLifecycle
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

function unavailableTest(config: PortProofProjectConfig | undefined, reason: string): ExistingTestsResult {
  return {
    command: config?.test.command ?? "unavailable",
    args: config?.test.args ?? [],
    exitCode: null,
    passed: false,
    durationMs: 0,
    stdout: "",
    stderr: reason,
  };
}

function unavailableProof(expected: unknown): SemanticProofResult {
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

function unverifiable(params: {
  runId: string;
  startedAt: string;
  targetRef: string;
  reason: string;
  config?: PortProofProjectConfig;
  provenance?: RepositoryProvenance;
  contract?: { value: BehaviorContract; hash: string };
  evidence?: BackportProofReport["evidence"];
  tests?: ExistingTestsResult;
  proof?: SemanticProofResult;
  workspace?: WorkspaceStatusResult;
  preparation?: PreparationResult;
}): BackportProofReport {
  const expected = params.contract?.value.observable.expected ?? null;
  return {
    runId: params.runId,
    fixture: "repository",
    branch: params.targetRef,
    commitSha: params.provenance?.target.commitSha ?? "unknown",
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
    ...(params.provenance !== undefined && { provenance: params.provenance }),
    ...(params.preparation !== undefined && { preparation: params.preparation }),
    mechanical: {
      existingTests: params.tests ?? unavailableTest(params.config, params.reason),
      ...(params.workspace !== undefined && { workspace: params.workspace }),
    },
    semantic: { proof: params.proof ?? unavailableProof(expected) },
    ...(params.contract !== undefined && { contract: params.contract }),
    ...(params.evidence !== undefined && { evidence: params.evidence }),
    verdict: "UNVERIFIABLE",
    unverifiableReason: params.reason,
  };
}

/** Verify Bob evidence against an arbitrary local JS/TS Git repository. */
export async function verifyRepository(
  options: VerifyRepositoryOptions
): Promise<BackportProofReport> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  options.onPhase?.("PREPARING");

  let config: PortProofProjectConfig;
  try {
    config = await loadProjectConfig(options.repositoryPath);
  } catch (error) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      reason: `Project configuration validation failed: ${safeError(error, [[options.repositoryPath, "[repository]"]])}`,
    });
  }

  const adapterId: string = config.language;
  const adapter = getLanguageAdapter(adapterId);
  if (!adapter) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      reason: `Unsupported language adapter: ${config.language}`,
    });
  }

  let repositoryRoot: string;
  let provenance: RepositoryProvenance;
  try {
    const inspected = await inspectRepository({
      repositoryPath: options.repositoryPath,
      sourceRef: options.sourceRef,
      targetRef: options.targetRef,
      test: config.test,
    });
    repositoryRoot = inspected.root;
    provenance = inspected.provenance;
  } catch (error) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      reason: `Repository validation failed: ${safeError(error, [[options.repositoryPath, "[repository]"]])}`,
    });
  }

  let contract: BehaviorContract;
  let contractHash: string;
  options.onPhase?.("VALIDATING_CONTRACT");
  try {
    contract = await loadBehaviorContract(options.contractPath);
    contractHash = hashBehaviorContract(contract);
  } catch (error) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      provenance,
      reason: `Behavior contract validation failed: ${safeError(error, [
        [options.contractPath, "[contract]"],
        [repositoryRoot, provenance.repository],
      ])}`,
    });
  }
  const contractArtifact = { value: contract, hash: contractHash };

  let metadata: ExecutableProof;
  try {
    metadata = await loadExecutableProofMetadata(options.proofMetadataPath);
    validateArtifactRelationships(contract, metadata);
  } catch (error) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      provenance,
      contract: contractArtifact,
      reason: `Executable proof evidence validation failed: ${safeError(error, [
        [options.proofMetadataPath, "[proof metadata]"],
        [repositoryRoot, provenance.repository],
      ])}`,
    });
  }

  let sourceProofBytes: Buffer;
  let sourceProofHash: string;
  options.onPhase?.("FREEZING_PROOF");
  try {
    const artifact = await loadProofArtifact(repositoryRoot, metadata.file);
    sourceProofBytes = artifact.bytes;
    sourceProofHash = artifact.sourceProofHash;
  } catch (error) {
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      provenance,
      contract: contractArtifact,
      reason: `Executable proof file validation failed: ${safeError(error, [
        [repositoryRoot, provenance.repository],
      ])}`,
    });
  }

  let workspaceDir: string | undefined;
  let workspaceStatus: WorkspaceStatusResult | undefined;
  const runState: { preparation?: PreparationResult } = {};
  const hashes: HashLifecycle = {};
  const evidence = (): NonNullable<BackportProofReport["evidence"]> => ({
    contract: { id: contract.id, hash: contractHash },
    executableProof: proofEvidence(metadata, sourceProofHash, hashes),
  });
  const fail = async (
    reason: string,
    tests?: ExistingTestsResult,
    proof?: SemanticProofResult
  ): Promise<BackportProofReport> => {
    if (workspaceDir && !options.keepWorkspace) await safeCleanup(workspaceDir);
    return unverifiable({
      runId,
      startedAt,
      targetRef: options.targetRef,
      config,
      provenance,
      contract: contractArtifact,
      evidence: evidence(),
      reason,
      ...(tests !== undefined && { tests }),
      ...(proof !== undefined && { proof }),
      ...(workspaceStatus !== undefined && { workspace: workspaceStatus }),
      ...(runState.preparation !== undefined && { preparation: runState.preparation }),
    });
  };

  try {
    const workspace = await createRepositoryWorkspace(repositoryRoot, provenance.target.commitSha);
    workspaceDir = workspace.dir;
    workspaceStatus = workspace.status;
  } catch (error) {
    return fail(`Isolated target checkout failed: ${safeError(error, [[repositoryRoot, provenance.repository]])}`);
  }

  const preparationExecution = await prepareRepository(
    workspaceDir,
    provenance.target.commitSha,
    config.prepare ?? []
  );
  const preparation = preparationExecution.result;
  runState.preparation = preparation;
  if (!preparation.passed) {
    return fail(
      preparationExecution.failureReason ?? "Repository preparation integrity could not be established"
    );
  }

  const copiedProofPath = join(workspaceDir, COPIED_PROOF_FILENAME);
  try {
    await writeFile(copiedProofPath, sourceProofBytes, { flag: "wx" });
    hashes.copied = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(`Executable proof could not be copied without rewriting: ${String(error)}`);
  }
  if (hashes.copied !== sourceProofHash) return fail("Copied proof hash mismatch");

  options.onPhase?.("VALIDATING_PUBLIC_BOUNDARY");
  try {
    await adapter.validateExecutableProof(copiedProofPath, workspaceDir, metadata);
  } catch (error) {
    return fail(`Executable proof public-boundary validation failed: ${String(error)}`);
  }

  options.onPhase?.("CHECKING_TESTS");
  const testProcess = await runProcess(config.test.command, config.test.args, { cwd: workspaceDir });
  const tests: ExistingTestsResult = {
    command: config.test.command,
    args: config.test.args,
    exitCode: testProcess.exitCode,
    passed: testProcess.exitCode === 0,
    durationMs: testProcess.durationMs,
    stdout: testProcess.stdout,
    stderr: testProcess.stderr,
  };

  try {
    hashes.preExecution = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(`Proof pre-execution hashing failed: ${String(error)}`, tests);
  }
  if (hashes.preExecution !== sourceProofHash) return fail("Pre-execution proof hash mismatch", tests);

  options.onPhase?.("RUNNING_PROOF");
  const proofProcess = await runProcess("node", [COPIED_PROOF_FILENAME], { cwd: workspaceDir });
  const observed = adapter.parseObservation(proofProcess.stdout, contract.observable.expected);
  const observationMatches =
    observed !== null && canonicalSerialize(observed) === canonicalSerialize(contract.observable.expected);
  const proof: SemanticProofResult = {
    command: "node",
    args: [COPIED_PROOF_FILENAME],
    exitCode: proofProcess.exitCode,
    passed: proofProcess.exitCode === 0 && observationMatches,
    durationMs: proofProcess.durationMs,
    expected: contract.observable.expected,
    observed,
    stdout: proofProcess.stdout,
    stderr: proofProcess.stderr,
  };

  try {
    hashes.postExecution = await hashProofFile(copiedProofPath);
  } catch (error) {
    return fail(`Proof post-execution hashing failed: ${String(error)}`, tests, proof);
  }
  if (hashes.postExecution !== sourceProofHash) {
    return fail("Post-execution proof hash mismatch", tests, proof);
  }

  if (!options.keepWorkspace) await safeCleanup(workspaceDir);

  let verdict: BackportProofReport["verdict"];
  let unverifiableReason: string | undefined;
  if (tests.exitCode === null || proof.exitCode === null) {
    verdict = "UNVERIFIABLE";
    unverifiableReason = "A required command did not complete normally";
  } else if (!tests.passed) {
    verdict = "UNVERIFIABLE";
    unverifiableReason = "Existing target tests did not pass, so semantic behavior cannot be isolated";
  } else if (observed === null) {
    verdict = "UNVERIFIABLE";
    unverifiableReason = "The JavaScript adapter could not parse a meaningful proof observation";
  } else {
    verdict = proof.passed ? "PROVEN" : "NOT_PROVEN";
  }

  return {
    runId,
    fixture: "repository",
    branch: options.targetRef,
    commitSha: provenance.target.commitSha,
    startedAt,
    completedAt: new Date().toISOString(),
    provenance,
    preparation,
    mechanical: { existingTests: tests, workspace: workspaceStatus },
    semantic: { proof },
    contract: contractArtifact,
    integrity: { contractHash, proofHash: sourceProofHash },
    evidence: evidence(),
    verdict,
    ...(unverifiableReason !== undefined && { unverifiableReason }),
  };
}
