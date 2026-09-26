import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { BackportProofReport } from "../src/core/types.js";
import { LandingPage } from "../src/web/routes/LandingPage.js";
import { ReportContent } from "../src/web/routes/ReportPage.js";
import { VerifyPage } from "../src/web/routes/VerifyPage.js";
import { initialProofRunState, proofRunReducer } from "../src/web/state/proofRunReducer.js";
import type { DemoEvidenceBundle } from "../src/web/types.js";

const proofHash = "9780973a1fb93f36692e478c187eb7c5e153a4daee465b1f90182ff055060a02";
const contractHash = "7ed587066bba8fd4fba7201d3f36e1b3bf1d31f743d9b3ec9f272ffa8b134319";

const report: BackportProofReport = {
  runId: "20260926120000-abcd",
  fixture: "semantic-backport",
  branch: "demo-clean-backport",
  commitSha: "c69a5cae895a689043fd11891f90b2d81d9de4c4",
  startedAt: "2026-09-26T12:00:00.000Z",
  completedAt: "2026-09-26T12:00:01.000Z",
  mechanical: {
    existingTests: { command: "npm", args: ["test"], exitCode: 0, passed: true, durationMs: 250, stdout: "ok", stderr: "" },
  },
  semantic: {
    proof: { command: "node", args: [".portproof-proof.mjs"], exitCode: 1, passed: false, durationMs: 40, expected: { timeout: 0 }, observed: { timeout: 5000 }, stdout: "PORTPROOF_OBSERVED timeout=5000", stderr: "assertion" },
  },
  contract: {
    value: { version: "1", id: "create-request-options-zero-timeout", intent: "Zero disables timeout", observable: { setup: { REQUEST_TIMEOUT_MS: "0" }, operation: "createRequestOptions", expected: { timeout: 0 } } },
    hash: contractHash,
  },
  integrity: { contractHash, proofHash },
  evidence: {
    contract: { id: "create-request-options-zero-timeout", hash: contractHash },
    executableProof: { file: "artifacts/bob/proofs/request-timeout-zero.proof.mjs", publicBoundary: { module: "src/request.js", export: "createRequestOptions" }, sourceProofHash: proofHash, copiedProofHash: proofHash, preExecutionProofHash: proofHash, postExecutionProofHash: proofHash, integrityValid: true },
  },
  verdict: "NOT_PROVEN",
};

const bobEvidence: DemoEvidenceBundle = {
  sourceAnalysis: { sourceCommit: "49bbeb3aced30db0b8d7b9f9a6125d33983a05a1", intent: "Zero must remain zero", implementationPaths: [{ file: "src/request.js" }] },
  targetAnalysis: { targetRef: "release/1.x", routingPaths: [{ finding: "Public path uses parseLegacyTimeout" }] },
  targetMapping: { source: { publicApi: "createRequestOptions", implementationPaths: ["src/request.js:parseModernTimeout"] }, target: { publicApi: "createRequestOptions", implementationPaths: ["src/request.js:parseLegacyTimeout"] }, semanticGap: { description: "The target path bypasses the fixed parser." } },
  executableProof: { publicBoundary: { module: "src/request.js", export: "createRequestOptions" } },
  repairProposal: { reasoning: "Route through parseModernTimeout." },
  artifactPaths: { sourceAnalysis: "artifacts/bob/source-analysis.json", targetAnalysis: "artifacts/bob/target-analysis.json", behaviorContract: "artifacts/bob/behavior-contract.candidate.json", targetMapping: "artifacts/bob/target-mapping.json", executableProof: "artifacts/bob/executable-proof.json", repairProposal: "artifacts/bob/repair-proposal.json" },
};

describe("web truth boundary", () => {
  it("cannot enter a verdict state from an event without a backend report", () => {
    const preparing = proofRunReducer(initialProofRunState, { type: "RUN_ACCEPTED", runId: "run" });
    const attempted = proofRunReducer(preparing, {
      type: "PHASE_RECEIVED",
      event: { sequence: 1, operation: "VERIFY", phase: "COMPLETED", at: "now", verdict: "PROVEN" },
    });
    expect(attempted.status).toBe("PREPARING");
    expect(attempted.report).toBeNull();
  });

  it("labels the landing contradiction as preview data and has no confidence metric", () => {
    const html = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(html).toContain("Demo preview · example data");
    expect(html).toContain("NOT PROVEN");
    expect(html.toLowerCase()).not.toContain("confidence");
    expect(html).toContain("Use PortProof on your repository");
    expect(html).toContain("portproof verify-repo");
  });

  it("uses a human-readable demo title with the technical identifier secondary", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/verify"]}><VerifyPage /></MemoryRouter>);
    expect(html).toContain("Zero-timeout backport");
    expect(html).toContain("REQUEST_TIMEOUT_MS=0");
  });

  it("renders one unchanged frozen-proof signature from repair report data", () => {
    const repaired: BackportProofReport = {
      ...report,
      verdict: "PROVEN",
      repair: {
        proposal: { contractId: "create-request-options-zero-timeout", targetRef: "demo-clean-backport", modifiedPaths: ["src/request.js"] },
        patchHash: "a".repeat(64),
        baseCommitSha: report.commitSha,
        applied: true,
        policyValid: true,
        changedPaths: ["src/request.js"],
        before: { verdict: "NOT_PROVEN", existingTestsPassed: true, proofPassed: false, expected: { timeout: 0 }, observed: { timeout: 5000 }, proofHash, contractHash, existingTestsDurationMs: 1, proofDurationMs: 1, proofExitCode: 1 },
        after: { verdict: "PROVEN", existingTestsPassed: true, proofPassed: true, expected: { timeout: 0 }, observed: { timeout: 0 }, proofHash, contractHash, existingTestsDurationMs: 1, proofDurationMs: 1, proofExitCode: 0 },
      },
    };
    const html = renderToStaticMarkup(<MemoryRouter><ReportContent payload={{ report: repaired, bobEvidence }} /></MemoryRouter>);
    expect(html).toContain("Same frozen proof");
    expect(html).toContain("UNCHANGED");
    expect(html).toContain("Observed <strong>5000</strong>");
    expect(html).toContain("Observed <strong>0</strong>");
  });

  it("renders the report route evidence from a core report", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ReportContent payload={{ report, bobEvidence }} /></MemoryRouter>);
    expect(html).toContain("Backport Proof Report");
    expect(html).toContain("BehaviorContract");
    expect(html).toContain("Deterministic verification");
    expect(html).toContain(proofHash);
    expect(html).toContain("Bob-generated evidence");
  });

  it("renders canonical generic repository provenance before Bob demo fallbacks", () => {
    const genericReport: BackportProofReport = {
      ...report,
      fixture: "repository",
      branch: "legacy-root-branch",
      commitSha: "0".repeat(40),
      provenance: {
        repository: "independent-repository",
        source: { ref: "fix/leading-zero", commitSha: "1".repeat(40) },
        target: { ref: "v4.0.1", commitSha: "2".repeat(40) },
        test: { command: "npm", args: ["test"] },
      },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter><ReportContent payload={{ report: genericReport, bobEvidence }} /></MemoryRouter>
    );
    expect(html).toContain("independent-repository");
    expect(html).toContain("fix/leading-zero");
    expect(html).toContain("v4.0.1");
    expect(html).toContain("1".repeat(40));
    expect(html).toContain("2".repeat(40));
    expect(html).not.toContain("legacy-root-branch");
  });
});
