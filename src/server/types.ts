import type { BackportProofReport, RepairPhase, VerificationPhase } from "../core/types.js";

export type DemoPhase = VerificationPhase | RepairPhase | "COMPLETED" | "ERROR";
export type DemoRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "ERROR";
export type DemoOperation = "VERIFY" | "REPAIR";

export interface DemoEvent {
  sequence: number;
  operation: DemoOperation;
  phase: DemoPhase;
  at: string;
  verdict?: BackportProofReport["verdict"];
}

export interface DemoRunSnapshot {
  runId: string;
  status: DemoRunStatus;
  operation: DemoOperation;
  phase: DemoPhase;
  events: DemoEvent[];
  report?: BackportProofReport;
  error?: string;
}

export interface DemoEvidenceBundle {
  sourceAnalysis: Record<string, unknown>;
  targetAnalysis: Record<string, unknown>;
  targetMapping: Record<string, unknown>;
  executableProof: Record<string, unknown>;
  repairProposal: Record<string, unknown>;
  artifactPaths: {
    sourceAnalysis: string;
    targetAnalysis: string;
    behaviorContract: string;
    targetMapping: string;
    executableProof: string;
    repairProposal: string;
  };
}

export interface DemoReportResponse {
  report: BackportProofReport;
  bobEvidence: DemoEvidenceBundle;
}
