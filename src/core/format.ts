/**
 * Terminal output formatter.
 *
 * Renders BackportProofReport as a concise human-readable terminal report.
 * The contradiction (mechanical PASS + semantic FAIL) is the dominant visual.
 * No AI confidence scores. No color codes that would corrupt CI logs when
 * FORCE_COLOR is not set — use ANSI only when stdout is a TTY.
 */

import type { BackportProofReport, Verdict } from "./types.js";

// ---------------------------------------------------------------------------
// ANSI color helpers (TTY-only)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- isTTY may be undefined at runtime despite the type declaration
const isTTY = Boolean(process.stdout.isTTY);

function bold(s: string): string {
  return isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}
function red(s: string): string {
  return isTTY ? `\x1b[31m${s}\x1b[0m` : s;
}
function green(s: string): string {
  return isTTY ? `\x1b[32m${s}\x1b[0m` : s;
}
function yellow(s: string): string {
  return isTTY ? `\x1b[33m${s}\x1b[0m` : s;
}
function dim(s: string): string {
  return isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

// ---------------------------------------------------------------------------
// Status tokens
// ---------------------------------------------------------------------------

function passToken(passed: boolean): string {
  return passed ? green("PASS") : red("FAIL");
}

function verdictToken(verdict: Verdict): string {
  switch (verdict) {
    case "PROVEN":
      return bold(green("PROVEN"));
    case "NOT_PROVEN":
      return bold(red("NOT_PROVEN"));
    case "UNVERIFIABLE":
      return bold(yellow("UNVERIFIABLE"));
  }
}

// ---------------------------------------------------------------------------
// Value stringification (safe for unknown type)
// ---------------------------------------------------------------------------

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

const COL1 = 24; // label column width

function row(label: string, value: string): string {
  return `  ${label.padEnd(COL1)}${value}`;
}

function separator(char = "─", width = 50): string {
  return dim(char.repeat(width));
}

// ---------------------------------------------------------------------------
// Public formatter
// ---------------------------------------------------------------------------

/**
 * Format a BackportProofReport as a multi-line terminal string.
 * Caller is responsible for writing to stdout.
 */
export function formatReport(report: BackportProofReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold("PORTPROOF"));
  lines.push(separator());

  lines.push(row("Fixture", report.fixture));
  lines.push(row("Branch", report.branch));
  lines.push(row("Commit", dim(report.commitSha.slice(0, 12))));
  lines.push(row("Run ID", dim(report.runId)));

  // ── MECHANICAL ──────────────────────────────────────────────────────────
  lines.push("");
  lines.push(bold("MECHANICAL"));

  const tests = report.mechanical.existingTests;
  const testStatus = tests.exitCode === null ? yellow("ERROR") : passToken(tests.passed);
  lines.push(
    row(
      "Existing tests",
      `${testStatus}  ${dim(String(tests.durationMs) + "ms")}`
    )
  );

  // ── SEMANTIC ─────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(bold("SEMANTIC"));

  const proof = report.semantic.proof;
  const proofStatus =
    proof.exitCode === null ? yellow("ERROR") : passToken(proof.passed);
  lines.push(
    row(
      "Behavior proof",
      `${proofStatus}  ${dim(String(proof.durationMs) + "ms")}`
    )
  );

  if (proof.expected !== null && proof.expected !== undefined) {
    lines.push(row("Expected", stringifyValue(proof.expected)));
  }

  if (proof.observed !== null && proof.observed !== undefined) {
    const observed = stringifyValue(proof.observed);
    const observedFormatted =
      !proof.passed && proof.observed !== proof.expected
        ? red(observed)
        : green(observed);
    lines.push(row("Observed", observedFormatted));
  }

  // ── VERDICT ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(bold("VERDICT"));
  lines.push(separator());
  lines.push(`  ${verdictToken(report.verdict)}`);

  if (report.unverifiableReason !== undefined) {
    lines.push("");
    lines.push(dim(`  Reason: ${report.unverifiableReason}`));
  }

  lines.push(separator());
  lines.push("");

  return lines.join("\n");
}

function repairValue(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const values = Object.values(value);
    if (values.length === 1) return stringifyValue(values[0]);
  }
  return stringifyValue(value);
}

/** Render the deterministic before/repair/after history. */
export function formatRepairReport(report: BackportProofReport): string {
  const repair = report.repair;
  if (!repair) return formatReport(report);

  const lines: string[] = ["", bold("PORTPROOF REPAIR VERIFICATION"), separator()];
  const appendStage = (label: string, stage: typeof repair.before): void => {
    lines.push("", bold(label));
    if (!stage) {
      lines.push(row("Status", yellow("UNAVAILABLE")));
      return;
    }
    lines.push(row("Existing tests", passToken(stage.existingTestsPassed)));
    lines.push(row("Behavior proof", passToken(stage.proofPassed)));
    lines.push(row("Expected", repairValue(stage.expected)));
    lines.push(row("Observed", repairValue(stage.observed)));
    lines.push(row("Proof hash", dim(stage.proofHash)));
    lines.push(row("Verdict", verdictToken(stage.verdict)));
  };

  appendStage("BEFORE REPAIR", repair.before);

  lines.push("", bold("BOB REPAIR"));
  lines.push(row("Patch", repair.applied && repair.policyValid ? green("VALID") : yellow("REJECTED")));
  lines.push(row("Modified paths", repair.changedPaths.join(", ") || "none"));
  const proofHash = repair.before?.proofHash ?? report.integrity?.proofHash;
  if (proofHash) lines.push(row("Proof hash", dim(proofHash)));

  appendStage("AFTER REPAIR", repair.after);

  lines.push("", bold("FINAL VERDICT"), separator(), `  ${verdictToken(report.verdict)}`);
  if (report.unverifiableReason !== undefined) {
    lines.push("", dim(`  Reason: ${report.unverifiableReason}`));
  }
  lines.push(separator(), "");
  return lines.join("\n");
}
