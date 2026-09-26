import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BehaviorContractPanel, BobEvidencePanel, DeterministicEvidencePanel, MappingPanel, RepairHistory } from "../components/ProofEvidence.js";
import { StatusPill } from "../components/StatusPill.js";
import { VerdictStrip } from "../components/VerdictStrip.js";
import { useProofRun } from "../hooks/useProofRun.js";
import { getDemoEvidence } from "../lib/api.js";
import { formatDuration, formatValue, safeText, shortHash } from "../lib/format.js";
import type { DemoEvidenceBundle } from "../types.js";

const phaseLabels: Record<string, string> = {
  PREPARING: "Preparing isolated checkout",
  VALIDATING_CONTRACT: "Validating BehaviorContract",
  FREEZING_PROOF: "Freezing proof bytes",
  VALIDATING_PUBLIC_BOUNDARY: "Validating public boundary",
  CHECKING_TESTS: "Running existing tests",
  RUNNING_PROOF: "Executing behavior proof",
  VALIDATING_PATCH: "Validating Bob patch",
  VERIFYING_BEFORE_STATE: "Confirming the failed baseline",
  APPLYING_REPAIR: "Applying policy-approved repair",
  RUNNING_TESTS: "Rerunning existing tests",
  REVERIFYING_FROZEN_PROOF: "Reverifying frozen proof",
  COMPLETED: "Deterministic verdict recorded",
};

function PhaseTimeline({ events, current }: { events: { sequence: number; phase: string; operation: string }[]; current: string | null }) {
  if (events.length === 0) return null;
  return (
    <section className="phase-timeline" aria-label="Run progress">
      {events.map((event, index) => (
        <div className={`phase-step ${event.phase === current ? "phase-step--current" : ""}`} key={`${String(event.sequence)}-${event.operation}`}>
          <span aria-hidden="true">{index + 1}</span>
          <div><small>{event.operation}</small><strong>{phaseLabels[event.phase] ?? event.phase}</strong></div>
        </div>
      ))}
    </section>
  );
}

export function VerifyPage() {
  const [searchParams] = useSearchParams();
  const { state, run, repair } = useProofRun(searchParams.get("autorun") === "1");
  const [evidence, setEvidence] = useState<DemoEvidenceBundle | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    void getDemoEvidence().then(setEvidence).catch((error: unknown) => {
      setEvidenceError(String(error));
    });
  }, []);

  const report = state.report;
  const running = ["PREPARING", "VERIFYING", "REPAIRING"].includes(state.status);
  const sourceCommit = evidence ? safeText(evidence.sourceAnalysis.sourceCommit, "source-fix") : "source-fix";

  return (
    <main className="workspace page-shell">
      <section className="run-header">
        <div>
          <p className="eyebrow">Prepared scenario · semantic-backport</p>
          <h1>Zero-timeout backport</h1>
          <code className="scenario-identifier">REQUEST_TIMEOUT_MS=0</code>
          <div className="branch-line">
            <code>source-fix@{shortHash(sourceCommit, 8)}</code>
            <span aria-hidden="true">→</span>
            <code>demo-clean-backport</code>
          </div>
        </div>
        <div className="run-header__actions">
          {state.runId && <span className="run-id">run/{state.runId}</span>}
          <button className="button button--primary" disabled={running} onClick={() => void run()}>
            {running ? "Verification running…" : report ? "Run fresh proof" : "Run proof"}
          </button>
        </div>
      </section>

      <VerdictStrip state={state.status} report={report} />
      <PhaseTimeline events={state.phaseHistory} current={state.phase} />

      {state.error && <div className="error-banner" role="alert"><strong>Run error</strong><span>{state.error}</span></div>}
      {evidenceError && <div className="error-banner" role="alert"><strong>Evidence unavailable</strong><span>{evidenceError}</span></div>}

      {!report && (
        <section className="workspace-empty">
          <div className="workspace-empty__mark" aria-hidden="true">P</div>
          <p className="eyebrow">Deterministic verification</p>
          <h2>{running ? phaseLabels[state.phase ?? "PREPARING"] : "Ready to expose the semantic gap."}</h2>
          <p>{running ? "PortProof is executing the prepared fixture. Results appear only after the backend records them." : "Run the public-boundary proof against the clean-but-wrong backport. No credentials or repository input required."}</p>
          {!running && <button className="button button--primary" onClick={() => void run()}>Run broken backport demo <span aria-hidden="true">→</span></button>}
        </section>
      )}

      {report && (
        <>
          <section className="evidence-split">
            <article className="panel evidence-card evidence-card--mechanical">
              <p className="panel-label">Mechanical evidence</p>
              <div className="evidence-card__title"><h2>Target checkout</h2><StatusPill status={report.mechanical.existingTests.passed ? "PASS" : "FAIL"} /></div>
              <dl className="metric-list">
                <div><dt>Candidate branch</dt><dd><code>{report.branch}</code></dd></div>
                <div><dt>Commit</dt><dd><code title={report.commitSha}>{shortHash(report.commitSha, 14)}</code></dd></div>
                <div><dt>Existing tests</dt><dd>{report.mechanical.existingTests.passed ? "PASS" : "FAIL"}</dd></div>
                <div><dt>Duration</dt><dd>{formatDuration(report.mechanical.existingTests.durationMs)}</dd></div>
              </dl>
            </article>
            <article className={`panel evidence-card evidence-card--semantic evidence-card--${report.semantic.proof.passed ? "pass" : "fail"}`}>
              <p className="panel-label">Semantic evidence</p>
              <div className="evidence-card__title"><h2>Public behavior</h2><StatusPill status={report.semantic.proof.passed ? "PASS" : "FAIL"} /></div>
              <dl className="metric-list">
                <div><dt>Public export</dt><dd><code>{report.evidence?.executableProof.publicBoundary.export ?? "—"}</code></dd></div>
                <div><dt>Expected</dt><dd><strong>{formatValue(report.semantic.proof.expected)}</strong></dd></div>
                <div><dt>Observed</dt><dd><strong className={report.semantic.proof.passed ? "text-pass" : "text-fail"}>{formatValue(report.semantic.proof.observed)}</strong></dd></div>
                <div><dt>Proof SHA-256</dt><dd><code title={report.integrity?.proofHash}>{shortHash(report.integrity?.proofHash, 14)}</code></dd></div>
              </dl>
            </article>
          </section>

          <BehaviorContractPanel report={report} />
          {evidence && <MappingPanel evidence={evidence} />}
          {evidence && <BobEvidencePanel evidence={evidence} />}
          <DeterministicEvidencePanel report={report} />
          <RepairHistory report={report} />

          {report.verdict === "NOT_PROVEN" && !report.repair && evidence && (
            <section className="repair-callout">
              <div>
                <p className="eyebrow">Bob-proposed repair · deterministic gate required</p>
                <h2>Route the public request path through the existing modern parser.</h2>
                <p>The proposal may touch only <code>src/request.js</code>. PortProof will validate the exact patch, rerun existing tests, and execute the unchanged frozen proof.</p>
              </div>
              <div className="repair-callout__action">
                <EvidencePathCompat path={evidence.artifactPaths.repairProposal ?? "artifacts/bob/repair-proposal.json"} />
                <button className="button button--repair" disabled={state.status === "REPAIRING"} onClick={() => void repair()}>
                  {state.status === "REPAIRING" ? "Reverifying repair…" : "Apply Bob repair"} <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          )}

          <section className="report-cta">
            <div><p className="eyebrow">Permanent audit artifact</p><h2>Backport Proof Report</h2></div>
            <Link className="button button--secondary" to={`/report/${report.runId}`}>Open report <span aria-hidden="true">↗</span></Link>
          </section>
        </>
      )}
    </main>
  );
}

function EvidencePathCompat({ path }: { path: string }) {
  return <code className="evidence-path">{path}</code>;
}
