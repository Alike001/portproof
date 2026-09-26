import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BehaviorContractPanel, BobEvidencePanel, DeterministicEvidencePanel, MappingPanel, RepairHistory } from "../components/ProofEvidence.js";
import { SectionHeading } from "../components/SectionHeading.js";
import { StatusPill } from "../components/StatusPill.js";
import { VerdictStrip } from "../components/VerdictStrip.js";
import { getReport } from "../lib/api.js";
import { formatDuration, safeText, shortHash } from "../lib/format.js";
import type { DemoReportResponse } from "../types.js";

export function ReportContent({ payload }: { payload: DemoReportResponse }) {
  const { report, bobEvidence } = payload;
  const sourceCommit = safeText(bobEvidence.sourceAnalysis.sourceCommit, "unknown");
  const targetBaseRef = safeText(bobEvidence.targetAnalysis.targetRef, "release branch");
  const sameProof = report.repair
    ? report.repair.before?.proofHash === report.repair.after?.proofHash
    : report.evidence?.executableProof.integrityValid;

  return (
    <main className="report-page page-shell">
      <section className="report-hero">
        <div>
          <p className="eyebrow">Backport Proof Report · immutable run artifact</p>
          <h1>{report.verdict.replace("_", " ")}</h1>
          <p>{report.verdict === "PROVEN" ? "The target branch demonstrates the contracted behavior through its real public path." : "The target branch did not demonstrate the contracted behavior through its real public path."}</p>
        </div>
        <div className="report-hero__meta">
          <StatusPill status={report.verdict} label={report.verdict.replace("_", " ")} />
          <code>{report.runId}</code>
          <a href={`/api/reports/${encodeURIComponent(report.runId)}/raw`}>Download raw JSON ↗</a>
        </div>
      </section>

      <VerdictStrip state={report.verdict} report={report} />

      <section className="panel provenance-panel">
        <SectionHeading eyebrow="Provenance" title="Source intent → release target" action={sameProof ? <StatusPill status="PASS" label="SAME PROOF VERIFIED" /> : undefined} />
        <div className="provenance-flow">
          <div><span>Source fix</span><strong>source-fix</strong><code title={sourceCommit}>{shortHash(sourceCommit, 16)}</code></div>
          <b aria-hidden="true">→</b>
          <div><span>Target branch · based on {targetBaseRef}</span><strong>{report.branch}</strong><code title={report.commitSha}>{shortHash(report.commitSha, 16)}</code></div>
        </div>
        <div className="provenance-facts">
          <span>Fixture <code>{report.fixture}</code></span>
          <span>Started <time>{new Date(report.startedAt).toLocaleString()}</time></span>
          <span>Total wall time <code>{formatDuration(new Date(report.completedAt).getTime() - new Date(report.startedAt).getTime())}</code></span>
        </div>
      </section>

      <BehaviorContractPanel report={report} />
      <MappingPanel evidence={bobEvidence} />
      <RepairHistory report={report} />
      <DeterministicEvidencePanel report={report} />
      <BobEvidencePanel evidence={bobEvidence} />

      <section className="report-footnote">
        <div><strong>Scope of proof</strong><p>This verdict covers the validated BehaviorContract and declared public execution path. It is not a claim of universal program correctness.</p></div>
        <Link className="button button--secondary" to="/verify">Run another demo</Link>
      </section>
    </main>
  );
}

export function ReportPage() {
  const { runId } = useParams();
  const [payload, setPayload] = useState<DemoReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setError("Missing report identifier.");
      return;
    }
    void getReport(runId).then(setPayload).catch((reason: unknown) => {
      setError(String(reason));
    });
  }, [runId]);

  if (error) return <main className="page-shell route-message"><p className="eyebrow">Report unavailable</p><h1>We could not load this proof report.</h1><p>{error}</p><Link className="button button--primary" to="/verify">Open demo workspace</Link></main>;
  if (!payload) return <main className="page-shell route-message"><p className="eyebrow">Loading report</p><h1>Reading deterministic evidence…</h1></main>;
  return <ReportContent payload={payload} />;
}
