import type { BackportProofReport } from "../../core/types.js";
import type { WorkflowState } from "../types.js";
import { StatusPill } from "./StatusPill.js";

function finalStatus(state: WorkflowState, report: BackportProofReport | null) {
  if (report?.verdict === "PROVEN") return <StatusPill status="PROVEN" />;
  if (report?.verdict === "NOT_PROVEN") return <StatusPill status="NOT_PROVEN" label="NOT PROVEN" />;
  if (report?.verdict === "UNVERIFIABLE") return <StatusPill status="UNVERIFIABLE" />;
  if (["PREPARING", "VERIFYING", "REPAIRING"].includes(state)) return <StatusPill status="RUNNING" />;
  return <StatusPill status="PENDING" />;
}

export function VerdictStrip({ state, report }: { state: WorkflowState; report: BackportProofReport | null }) {
  const tests = report?.mechanical.existingTests;
  const proof = report?.semantic.proof;
  return (
    <section className="verdict-strip" aria-label="Verification verdict" aria-live="polite">
      <div className="verdict-cell verdict-cell--mechanical">
        <span className="verdict-cell__label">Mechanical</span>
        {report?.mechanical.workspace?.clean ? <StatusPill status="CLEAN" label="CHECKOUT CLEAN" /> : <StatusPill status="PENDING" />}
      </div>
      <div className="verdict-cell verdict-cell--mechanical">
        <span className="verdict-cell__label">Existing tests</span>
        {tests ? <StatusPill status={tests.passed ? "PASS" : "FAIL"} /> : <StatusPill status={state === "VERIFYING" ? "RUNNING" : "PENDING"} />}
      </div>
      <div className={`verdict-cell verdict-cell--semantic ${proof ? (proof.passed ? "verdict-cell--pass" : "verdict-cell--fail") : "verdict-cell--pending"}`}>
        <span className="verdict-cell__label">Semantic proof</span>
        {proof ? <StatusPill status={proof.passed ? "PASS" : "FAIL"} /> : <StatusPill status={state === "VERIFYING" ? "RUNNING" : "PENDING"} />}
      </div>
      <div className="verdict-cell verdict-cell--final">
        <span className="verdict-cell__label">PortProof verdict</span>
        {finalStatus(state, report)}
      </div>
    </section>
  );
}
