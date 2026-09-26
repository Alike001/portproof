import type { BackportProofReport } from "../core/types.js";

export type WorkflowState =
  | "IDLE"
  | "PREPARING"
  | "VERIFYING"
  | "NOT_PROVEN"
  | "REPAIRING"
  | "PROVEN"
  | "UNVERIFIABLE"
  | "ERROR";

export type DemoOperation = "VERIFY" | "REPAIR";

export interface DemoEvent {
  sequence: number;
  operation: DemoOperation;
  phase: string;
  at: string;
  verdict?: BackportProofReport["verdict"];
}

export interface DemoEvidenceBundle {
  sourceAnalysis: Record<string, unknown>;
  targetAnalysis: Record<string, unknown>;
  targetMapping: Record<string, unknown>;
  executableProof: Record<string, unknown>;
  repairProposal: Record<string, unknown>;
  artifactPaths: Record<string, string>;
}

export interface DemoRunSnapshot {
  runId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "ERROR";
  operation: DemoOperation;
  phase: string;
  events: DemoEvent[];
  report?: BackportProofReport;
  error?: string;
}

export interface DemoReportResponse {
  report: BackportProofReport;
  bobEvidence: DemoEvidenceBundle;
}

export interface ProofRunState {
  status: WorkflowState;
  runId: string | null;
  operation: DemoOperation | null;
  phase: string | null;
  phaseHistory: DemoEvent[];
  report: BackportProofReport | null;
  error: string | null;
}
