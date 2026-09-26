import type { BackportProofReport } from "../../core/types.js";
import { formatDuration, formatValue, objectAt, safeText, shortHash, textAt } from "../lib/format.js";
import type { DemoEvidenceBundle } from "../types.js";
import { SectionHeading } from "./SectionHeading.js";
import { StatusPill } from "./StatusPill.js";

function firstRecord(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const list = (value as Record<string, unknown>)[key];
  const first: unknown = Array.isArray(list) ? (list as unknown[])[0] : undefined;
  return typeof first === "object" && first !== null && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : {};
}

function EvidencePath({ children }: { children: string }) {
  return <code className="evidence-path">{children}</code>;
}

export function BehaviorContractPanel({ report }: { report: BackportProofReport }) {
  const contract = report.contract?.value;
  if (!contract) return null;
  return (
    <section className="panel contract-panel">
      <SectionHeading eyebrow="Validated contract" title="BehaviorContract" action={<EvidencePath>{contract.id}</EvidencePath>} />
      <p className="contract-intent">{contract.intent}</p>
      <div className="contract-grid">
        <div><span>Setup</span><code>{Object.entries(contract.observable.setup).map(([key, value]) => `${key}=${value}`).join(" · ")}</code></div>
        <div><span>Public operation</span><code>{contract.observable.operation}</code></div>
        <div><span>Expected</span><strong>{formatValue(contract.observable.expected)}</strong></div>
        <div><span>Observed</span><strong className={report.semantic.proof.passed ? "text-pass" : "text-fail"}>{formatValue(report.semantic.proof.observed)}</strong></div>
      </div>
      <details className="disclosure">
        <summary>View raw contract JSON</summary>
        <pre>{JSON.stringify(contract, null, 2)}</pre>
      </details>
    </section>
  );
}

export function MappingPanel({ evidence }: { evidence: DemoEvidenceBundle }) {
  const source = objectAt(evidence.targetMapping, "source");
  const target = objectAt(evidence.targetMapping, "target");
  const gap = objectAt(evidence.targetMapping, "semanticGap");
  const sourcePaths = Array.isArray(source.implementationPaths) ? source.implementationPaths : [];
  const targetPaths = Array.isArray(target.implementationPaths) ? target.implementationPaths : [];
  return (
    <section className="panel mapping-panel">
      <SectionHeading eyebrow="Source → target mapping" title="The code moved. The routing did not." />
      <div className="mapping-grid">
        <div className="mapping-side">
          <span className="mapping-side__branch">Source fix · source-fix</span>
          <strong>{safeText(source.publicApi, "createRequestOptions")}</strong>
          {sourcePaths.map((path) => <EvidencePath key={String(path)}>{String(path)}</EvidencePath>)}
        </div>
        <div className="mapping-connector" aria-hidden="true"><span>semantic gap</span><b>→</b></div>
        <div className="mapping-side mapping-side--target">
          <span className="mapping-side__branch">Target · release/1.x</span>
          <strong>{safeText(target.publicApi, "createRequestOptions")}</strong>
          {targetPaths.map((path) => <EvidencePath key={String(path)}>{String(path)}</EvidencePath>)}
        </div>
      </div>
      <p className="gap-note"><span aria-hidden="true">!</span>{safeText(gap.description, "No semantic-gap description available.")}</p>
    </section>
  );
}

export function BobEvidencePanel({ evidence }: { evidence: DemoEvidenceBundle }) {
  const sourcePath = firstRecord(evidence.sourceAnalysis, "implementationPaths");
  const targetPath = firstRecord(evidence.targetAnalysis, "routingPaths");
  const gap = objectAt(evidence.targetMapping, "semanticGap");
  const boundary = objectAt(evidence.executableProof, "publicBoundary");
  const proposal = evidence.repairProposal;
  const cards = [
    {
      step: "01",
      role: "Source investigator",
      summary: textAt(evidence.sourceAnalysis, "intent"),
      path: `${safeText(sourcePath.file, "src/request.js")} · ${evidence.artifactPaths.sourceAnalysis ?? ""}`,
    },
    {
      step: "02",
      role: "Target investigator",
      summary: textAt(targetPath, "finding"),
      path: evidence.artifactPaths.targetAnalysis ?? "",
    },
    {
      step: "03",
      role: "Behavior mapper",
      summary: safeText(gap.description, "Mapped source intent to the target public path."),
      path: evidence.artifactPaths.targetMapping ?? "",
    },
    {
      step: "04",
      role: "Proof adapter",
      summary: `Declared ${safeText(boundary.export, "createRequestOptions")} from ${safeText(boundary.module, "src/request.js")} as the public boundary.`,
      path: evidence.artifactPaths.executableProof ?? "",
    },
    {
      step: "05",
      role: "Repair agent",
      summary: textAt(proposal, "reasoning"),
      path: evidence.artifactPaths.repairProposal ?? "",
    },
  ];
  return (
    <section className="panel bob-panel">
      <SectionHeading eyebrow="Bob-generated evidence" title="Investigation artifacts, not verdicts" />
      <div className="bob-timeline">
        {cards.map((card) => (
          <article className="bob-step" key={card.role}>
            <span className="bob-step__number">{card.step}</span>
            <div>
              <h3>{card.role}</h3>
              <p>{card.summary}</p>
              <EvidencePath>{card.path}</EvidencePath>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DeterministicEvidencePanel({ report }: { report: BackportProofReport }) {
  const tests = report.mechanical.existingTests;
  const proof = report.semantic.proof;
  const integrity = report.evidence?.executableProof;
  const hashRows = [
    ["Source", integrity?.sourceProofHash],
    ["Copied", integrity?.copiedProofHash],
    ["Pre-execution", integrity?.preExecutionProofHash],
    ["Post-execution", integrity?.postExecutionProofHash],
  ] as const;
  return (
    <section className="panel deterministic-panel">
      <SectionHeading eyebrow="Deterministic verification" title="Measured process and integrity evidence" action={integrity?.integrityValid ? <StatusPill status="PASS" label="INTEGRITY VALID" /> : undefined} />
      <div className="command-grid">
        <article className="command-card">
          <div><span>Existing tests</span><StatusPill status={tests.passed ? "PASS" : "FAIL"} /></div>
          <code>$ {tests.command} {tests.args.join(" ")}</code>
          <p>exit {String(tests.exitCode)} · {formatDuration(tests.durationMs)}</p>
        </article>
        <article className="command-card command-card--semantic">
          <div><span>Public behavior proof</span><StatusPill status={proof.passed ? "PASS" : "FAIL"} /></div>
          <code>$ {proof.command} {proof.args.join(" ")}</code>
          <p>exit {String(proof.exitCode)} · {formatDuration(proof.durationMs)}</p>
        </article>
      </div>
      <div className="primary-hash">
        <span>Proof SHA-256</span>
        <code>{integrity?.sourceProofHash ?? "unavailable"}</code>
      </div>
      <details className="disclosure integrity-details">
        <summary>Inspect contract and proof hash lifecycle</summary>
        <div className="hash-ledger">
          <div className="hash-ledger__contract"><span>Contract SHA-256</span><code>{report.contract?.hash ?? "unavailable"}</code></div>
          {hashRows.map(([label, hash]) => (
            <div key={label}><span>{label} proof hash</span><code title={hash ?? undefined}>{hash ?? "unavailable"}</code></div>
          ))}
        </div>
      </details>
      <div className="observation-line">
        <span>Expected <strong>{formatValue(proof.expected)}</strong></span>
        <b aria-hidden="true">→</b>
        <span>Observed <strong className={proof.passed ? "text-pass" : "text-fail"}>{formatValue(proof.observed)}</strong></span>
      </div>
      <details className="disclosure">
        <summary>Inspect stdout and stderr</summary>
        <div className="log-grid">
          <div><span>stdout</span><pre>{proof.stdout || "(empty)"}</pre></div>
          <div><span>stderr</span><pre>{proof.stderr || "(empty)"}</pre></div>
        </div>
      </details>
    </section>
  );
}

export function RepairHistory({ report }: { report: BackportProofReport }) {
  const repair = report.repair;
  if (!repair) return null;
  const sameProof = Boolean(
    repair.before?.proofHash && repair.before.proofHash === repair.after?.proofHash
  );
  return (
    <section className="panel repair-history same-proof-signature">
      <SectionHeading eyebrow="Same frozen proof" title="The target changed. The proof did not." action={sameProof ? <StatusPill status="PASS" label="UNCHANGED" /> : <StatusPill status="FAIL" label="HASH MISMATCH" />} />
      <div className="repair-comparison">
        <article>
          <span>Before repair</span>
          <StatusPill status={repair.before?.verdict === "NOT_PROVEN" ? "NOT_PROVEN" : "UNVERIFIABLE"} label={repair.before?.verdict.replace("_", " ") ?? "UNAVAILABLE"} />
          <p>Observed <strong>{formatValue(repair.before?.observed)}</strong></p>
          <p className="repair-timing">tests {repair.before ? formatDuration(repair.before.existingTestsDurationMs) : "—"} · proof {repair.before ? formatDuration(repair.before.proofDurationMs) : "—"}</p>
        </article>
        <div className="repair-patch same-proof-hash">
          <span>Proof SHA-256</span>
          <code title={repair.before?.proofHash}>{repair.before?.proofHash ?? "unavailable"}</code>
          <StatusPill status={sameProof ? "PASS" : "FAIL"} label={sameProof ? "UNCHANGED" : "MISMATCH"} />
          <details className="disclosure">
            <summary>Patch details</summary>
            <p><code title={repair.patchHash ?? undefined}>{shortHash(repair.patchHash, 20)}</code></p>
            <p>{repair.changedPaths.join(", ")}</p>
          </details>
        </div>
        <article>
          <span>After repair</span>
          <StatusPill status={repair.after?.verdict === "PROVEN" ? "PROVEN" : "NOT_PROVEN"} label={repair.after?.verdict.replace("_", " ") ?? "UNAVAILABLE"} />
          <p>Observed <strong>{formatValue(repair.after?.observed)}</strong></p>
          <p className="repair-timing">tests {repair.after ? formatDuration(repair.after.existingTestsDurationMs) : "—"} · proof {repair.after ? formatDuration(repair.after.proofDurationMs) : "—"}</p>
        </article>
      </div>
    </section>
  );
}
