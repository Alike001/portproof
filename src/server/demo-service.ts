import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyRepair } from "../core/repair.js";
import { generateRunId, reportDir, saveReport } from "../core/report.js";
import type { BackportProofReport } from "../core/types.js";
import { verify } from "../core/verify.js";
import { SemanticBackportAdapter } from "../scenarios/semantic-backport.js";
import { loadDemoEvidence } from "./demo-evidence.js";
import { DemoRunStore } from "./run-store.js";
import type { DemoReportResponse, DemoRunSnapshot } from "./types.js";

const BRANCH = "demo-clean-backport";
const CONTRACT = "artifacts/bob/behavior-contract.candidate.json";
const PROOF_METADATA = "artifacts/bob/executable-proof.json";
const REPAIR_PROPOSAL = "artifacts/bob/repair-proposal.json";
const PATCH = "artifacts/bob/repairs/request-timeout-zero.patch";
const RUN_ID_PATTERN = /^\d{8}\d{6}-[0-9a-f]{4}$/;

export class DemoService {
  readonly store = new DemoRunStore();
  private readonly scenario: SemanticBackportAdapter;

  constructor(readonly repositoryRoot: string) {
    this.scenario = new SemanticBackportAdapter(repositoryRoot);
  }

  startVerification(): string {
    const runId = generateRunId();
    this.store.create(runId);
    queueMicrotask(() => void this.executeVerification(runId));
    return runId;
  }

  startRepair(runId: string): void {
    const run = this.store.get(runId);
    if (!run) throw new Error("Demo run not found");
    if (run.status !== "COMPLETED" || run.report?.verdict !== "NOT_PROVEN") {
      throw new Error("Repair requires a completed NOT_PROVEN demo run");
    }
    this.store.begin(runId, "REPAIR", "VALIDATING_PATCH");
    queueMicrotask(() => void this.executeRepair(runId));
  }

  async getReport(runId: string): Promise<DemoReportResponse | undefined> {
    if (!RUN_ID_PATTERN.test(runId)) return undefined;
    const inMemory = this.store.get(runId)?.report;
    let report = inMemory;
    if (!report) {
      try {
        report = JSON.parse(
          await readFile(join(reportDir(this.repositoryRoot, runId), "report.json"), "utf8")
        ) as BackportProofReport;
      } catch {
        return undefined;
      }
    }
    return {
      report: this.sanitizeReport(report),
      bobEvidence: await loadDemoEvidence(this.repositoryRoot),
    };
  }

  getSnapshot(runId: string): DemoRunSnapshot | undefined {
    const snapshot = this.store.get(runId);
    if (!snapshot) return undefined;
    return {
      ...snapshot,
      ...(snapshot.report !== undefined && { report: this.sanitizeReport(snapshot.report) }),
      ...(snapshot.error !== undefined && { error: "The prepared demo run could not complete." }),
    };
  }

  async getEvidence(): Promise<DemoReportResponse["bobEvidence"]> {
    return loadDemoEvidence(this.repositoryRoot);
  }

  private async executeVerification(runId: string): Promise<void> {
    try {
      this.store.begin(runId, "VERIFY", "PREPARING");
      const report = await verify(this.scenario, {
        fixture: this.scenario.name,
        branch: BRANCH,
        contractPath: join(this.repositoryRoot, CONTRACT),
        proofMetadataPath: join(this.repositoryRoot, PROOF_METADATA),
        onPhase: (phase) => this.store.emit(runId, "VERIFY", phase),
      });
      const persisted = { ...report, runId };
      await saveReport(this.repositoryRoot, persisted);
      this.store.complete(runId, "VERIFY", persisted);
    } catch {
      this.store.fail(runId, "VERIFY", "The prepared verification run could not complete.");
    }
  }

  private async executeRepair(runId: string): Promise<void> {
    try {
      const originalWorkspaceStatus = this.store.get(runId)?.report?.mechanical.workspace;
      const report = await verifyRepair(this.scenario, {
        fixture: this.scenario.name,
        branch: BRANCH,
        contractPath: join(this.repositoryRoot, CONTRACT),
        proofMetadataPath: join(this.repositoryRoot, PROOF_METADATA),
        repairProposalPath: join(this.repositoryRoot, REPAIR_PROPOSAL),
        patchPath: join(this.repositoryRoot, PATCH),
        onPhase: (phase) => this.store.emit(runId, "REPAIR", phase),
      });
      const persisted: BackportProofReport = {
        ...report,
        runId,
        mechanical: {
          ...report.mechanical,
          ...(originalWorkspaceStatus !== undefined && { workspace: originalWorkspaceStatus }),
        },
      };
      await saveReport(this.repositoryRoot, persisted);
      this.store.complete(runId, "REPAIR", persisted);
    } catch {
      this.store.fail(runId, "REPAIR", "The prepared repair verification could not complete.");
    }
  }

  private sanitizeReport(report: BackportProofReport): BackportProofReport {
    const serialized = JSON.stringify(report)
      .replaceAll(this.repositoryRoot, ".")
      .replace(/\/tmp\/portproof-[^\s:'"]+/g, "[isolated workspace]");
    return JSON.parse(serialized) as BackportProofReport;
  }
}
