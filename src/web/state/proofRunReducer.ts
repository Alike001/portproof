import type { BackportProofReport } from "../../core/types.js";
import type { DemoEvent, ProofRunState } from "../types.js";

export const initialProofRunState: ProofRunState = {
  status: "IDLE",
  runId: null,
  operation: null,
  phase: null,
  phaseHistory: [],
  report: null,
  error: null,
};

export type ProofRunAction =
  | { type: "RUN_ACCEPTED"; runId: string }
  | { type: "REPAIR_ACCEPTED" }
  | { type: "PHASE_RECEIVED"; event: DemoEvent }
  | { type: "REPORT_RECEIVED"; report: BackportProofReport }
  | { type: "FAILED"; message: string }
  | { type: "RESET" };

function stateForVerdict(verdict: BackportProofReport["verdict"]): ProofRunState["status"] {
  switch (verdict) {
    case "PROVEN":
      return "PROVEN";
    case "NOT_PROVEN":
      return "NOT_PROVEN";
    case "UNVERIFIABLE":
      return "UNVERIFIABLE";
  }
}

/** Verdict-bearing states are reachable only from a backend report action. */
export function proofRunReducer(state: ProofRunState, action: ProofRunAction): ProofRunState {
  switch (action.type) {
    case "RUN_ACCEPTED":
      return {
        ...initialProofRunState,
        status: "PREPARING",
        runId: action.runId,
        operation: "VERIFY",
      };
    case "REPAIR_ACCEPTED":
      return {
        ...state,
        status: "REPAIRING",
        operation: "REPAIR",
        phase: "VALIDATING_PATCH",
        error: null,
      };
    case "PHASE_RECEIVED": {
      const phaseHistory = state.phaseHistory.some(
        (event) => event.sequence === action.event.sequence
      )
        ? state.phaseHistory
        : [...state.phaseHistory, action.event];
      const runningStatus =
        action.event.operation === "REPAIR"
          ? "REPAIRING"
          : action.event.phase === "PREPARING"
            ? "PREPARING"
            : "VERIFYING";
      return {
        ...state,
        status:
          action.event.phase === "ERROR"
            ? "ERROR"
            : action.event.phase === "COMPLETED"
              ? state.status
              : runningStatus,
        operation: action.event.operation,
        phase: action.event.phase,
        phaseHistory,
      };
    }
    case "REPORT_RECEIVED":
      return {
        ...state,
        status: stateForVerdict(action.report.verdict),
        phase: "COMPLETED",
        report: action.report,
        error: null,
      };
    case "FAILED":
      return { ...state, status: "ERROR", error: action.message };
    case "RESET":
      return initialProofRunState;
  }
}
