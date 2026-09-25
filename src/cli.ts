#!/usr/bin/env node
/**
 * PortProof CLI entry point.
 *
 * Usage:
 *   portproof verify --fixture <name> --branch <branch> [--keep-workspace]
 *
 * Exit codes:
 *   0  PROVEN
 *   1  NOT_PROVEN
 *   2  UNVERIFIABLE (infrastructure / setup failure)
 *   3  CLI usage error
 */

import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./core/verify.js";
import { saveReport } from "./core/report.js";
import { formatReport } from "./core/format.js";
import { SemanticBackportAdapter } from "./scenarios/semantic-backport.js";
import type { VerifyOptions } from "./core/types.js";

// ---------------------------------------------------------------------------
// Resolve repository root (the directory containing this CLI)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
// src/ is one level below repo root; adjust if the CLI moves
const REPO_ROOT = resolve(dirname(__filename), "..");

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

function getScenario(fixtureName: string, repoRoot: string) {
  switch (fixtureName) {
    case "semantic-backport":
      return new SemanticBackportAdapter(repoRoot);
    default:
      throw new Error(
        `Unknown fixture "${fixtureName}". Available: semantic-backport`
      );
  }
}

// ---------------------------------------------------------------------------
// Exit-code mapping
// ---------------------------------------------------------------------------

function exitCodeForVerdict(verdict: string): number {
  switch (verdict) {
    case "PROVEN":
      return 0;
    case "NOT_PROVEN":
      return 1;
    case "UNVERIFIABLE":
      return 2;
    default:
      return 2;
  }
}

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("portproof")
  .description(
    "Semantic backport verification — deterministic proof that a bug fix preserved its intended behavior"
  )
  .version("0.1.0");

program
  .command("verify")
  .description("Verify whether a target branch demonstrates the source fix's behavioral intent")
  .requiredOption("--fixture <name>", "Fixture to verify (e.g. semantic-backport)")
  .requiredOption("--branch <branch>", "Target branch to verify")
  .option("--keep-workspace", "Keep the temporary workspace after the run (for debugging)")
  .action(async (opts: { fixture: string; branch: string; keepWorkspace: boolean }) => {
    const options: VerifyOptions = {
      fixture: opts.fixture,
      branch: opts.branch,
      keepWorkspace: opts.keepWorkspace,
    };

    let scenario;
    try {
      scenario = getScenario(opts.fixture, REPO_ROOT);
    } catch (err) {
      console.error(`Error: ${String(err)}`);
      process.exit(3);
    }

    try {
      const report = await verify(scenario, options);

      // Print human-readable report
      process.stdout.write(formatReport(report));

      // Save JSON report
      try {
        const reportPath = await saveReport(REPO_ROOT, report);
        console.log(`Report saved: ${reportPath}`);
      } catch (saveErr) {
        console.error(`Warning: could not save report: ${String(saveErr)}`);
      }

      process.exit(exitCodeForVerdict(report.verdict));
    } catch (err) {
      console.error(`Unexpected error: ${String(err)}`);
      process.exit(2);
    }
  });

program.parse(process.argv);
