import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoEvidenceBundle } from "./types.js";

const artifactPaths = {
  sourceAnalysis: "artifacts/bob/source-analysis.json",
  targetAnalysis: "artifacts/bob/target-analysis.json",
  behaviorContract: "artifacts/bob/behavior-contract.candidate.json",
  targetMapping: "artifacts/bob/target-mapping.json",
  executableProof: "artifacts/bob/executable-proof.json",
  repairProposal: "artifacts/bob/repair-proposal.json",
} as const;

async function readObject(repositoryRoot: string, path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(repositoryRoot, path), "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected object evidence at ${path}`);
  }
  return parsed as Record<string, unknown>;
}

export async function loadDemoEvidence(repositoryRoot: string): Promise<DemoEvidenceBundle> {
  const [sourceAnalysis, targetAnalysis, targetMapping, executableProof, repairProposal] =
    await Promise.all([
      readObject(repositoryRoot, artifactPaths.sourceAnalysis),
      readObject(repositoryRoot, artifactPaths.targetAnalysis),
      readObject(repositoryRoot, artifactPaths.targetMapping),
      readObject(repositoryRoot, artifactPaths.executableProof),
      readObject(repositoryRoot, artifactPaths.repairProposal),
    ]);

  return {
    sourceAnalysis,
    targetAnalysis,
    targetMapping,
    executableProof,
    repairProposal,
    artifactPaths,
  };
}
