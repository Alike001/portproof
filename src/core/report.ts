/**
 * Report builder and persistence.
 *
 * Assembles BackportProofReport from deterministic process results.
 * Saves JSON under .portproof/runs/<runId>/report.json.
 * The reporter never infers or adjusts the verdict.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackportProofReport } from "./types.js";

// ---------------------------------------------------------------------------
// Run ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a run ID based on timestamp + short random suffix.
 * Format: YYYYMMDD-HHmmss-<hex4>
 */
export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `${date}-${rand}`;
}

// ---------------------------------------------------------------------------
// Report persistence
// ---------------------------------------------------------------------------

/**
 * Determine the directory where the report for a given run is stored.
 * Relative to the PortProof repository root.
 */
export function reportDir(repoRoot: string, runId: string): string {
  return join(repoRoot, ".portproof", "runs", runId);
}

/**
 * Save the BackportProofReport as report.json under .portproof/runs/<runId>/.
 * Creates directories as needed.
 */
export async function saveReport(
  repoRoot: string,
  report: BackportProofReport
): Promise<string> {
  const dir = reportDir(repoRoot, report.runId);
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return reportPath;
}
