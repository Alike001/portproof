#!/usr/bin/env node
/**
 * PortProof CLI entry point.
 *
 * Usage:
 *   portproof verify --fixture <name> --branch <branch> [--keep-workspace]
 *   portproof verify --fixture <name> --branch <branch>
 *     --contract <path> --proof-metadata <path>
 *   portproof init [--repo <path>]
 *   portproof verify-repo --repo <path> --source <ref> --target <ref>
 *     --contract <path> --proof-metadata <path>
 *
 * Exit codes:
 *   0  PROVEN
 *   1  NOT_PROVEN
 *   2  UNVERIFIABLE (infrastructure / setup failure)
 *   3  CLI usage error
 */

import { Command } from "commander";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./core/verify.js";
import { verifyRepair } from "./core/repair.js";
import { saveReport } from "./core/report.js";
import { formatRepairReport, formatReport } from "./core/format.js";
import { SemanticBackportAdapter } from "./scenarios/semantic-backport.js";
import type { VerifyOptions } from "./core/types.js";
import { initializeProjectConfig } from "./core/project-config.js";
import { verifyRepository } from "./core/verify-repository.js";

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
  .command("init")
  .description("Create a minimal PortProof project configuration")
  .option("--repo <path>", "Repository to initialize", ".")
  .option("--force", "Explicitly replace an existing project configuration")
  .action(async (opts: { repo: string; force: boolean }) => {
    try {
      const repositoryPath = resolve(process.cwd(), opts.repo);
      const path = await initializeProjectConfig(repositoryPath, { overwrite: opts.force });
      console.log(`Created ${relative(process.cwd(), path) || path}`);
      console.log("Next: open the repository in IBM Bob with portproof-verifier mode and the semantic-backport Skill.");
      console.log("Generate SourceAnalysis, TargetAnalysis, BehaviorContract, TargetMapping, and ExecutableProof artifacts.");
      console.log("Then run portproof verify-repo with the source ref, target ref, contract, and proof metadata.");
    } catch (error) {
      console.error(`Error: ${String(error)}`);
      process.exitCode = 3;
    }
  });

program
  .command("verify-repo")
  .description("Verify semantic backport evidence against a local JavaScript/TypeScript Git repository")
  .requiredOption("--repo <path>", "Local Git repository")
  .requiredOption("--source <ref>", "Source fix Git ref")
  .requiredOption("--target <ref>", "Target Git ref")
  .requiredOption("--contract <path>", "BehaviorContract JSON candidate")
  .requiredOption("--proof-metadata <path>", "ExecutableProof metadata JSON")
  .option("--keep-workspace", "Keep the temporary workspace after the run (for debugging)")
  .action(async (opts: {
    repo: string;
    source: string;
    target: string;
    contract: string;
    proofMetadata: string;
    keepWorkspace: boolean;
  }) => {
    try {
      const report = await verifyRepository({
        repositoryPath: resolve(process.cwd(), opts.repo),
        sourceRef: opts.source,
        targetRef: opts.target,
        contractPath: resolve(process.cwd(), opts.contract),
        proofMetadataPath: resolve(process.cwd(), opts.proofMetadata),
        keepWorkspace: opts.keepWorkspace,
      });
      process.stdout.write(formatReport(report));
      try {
        const reportPath = await saveReport(REPO_ROOT, report);
        console.log(`Report saved: ${relative(process.cwd(), reportPath)}`);
      } catch (saveError) {
        console.error(`Warning: could not save report: ${String(saveError)}`);
      }
      process.exitCode = exitCodeForVerdict(report.verdict);
    } catch (error) {
      console.error(`Unexpected error: ${String(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command("verify")
  .description("Verify whether a target branch demonstrates the source fix's behavioral intent")
  .requiredOption("--fixture <name>", "Fixture to verify (e.g. semantic-backport)")
  .requiredOption("--branch <branch>", "Target branch to verify")
  .option("--contract <path>", "BehaviorContract JSON candidate")
  .option("--proof-metadata <path>", "ExecutableProof metadata JSON")
  .option("--keep-workspace", "Keep the temporary workspace after the run (for debugging)")
  .action(async (opts: {
    fixture: string;
    branch: string;
    contract?: string;
    proofMetadata?: string;
    keepWorkspace: boolean;
  }) => {
    const options: VerifyOptions = {
      fixture: opts.fixture,
      branch: opts.branch,
      keepWorkspace: opts.keepWorkspace,
      ...(opts.contract !== undefined && {
        contractPath: resolve(REPO_ROOT, opts.contract),
      }),
      ...(opts.proofMetadata !== undefined && {
        proofMetadataPath: resolve(REPO_ROOT, opts.proofMetadata),
      }),
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

program
  .command("repair")
  .description("Validate and verify a Bob repair using the exact frozen proof")
  .requiredOption("--fixture <name>", "Fixture to repair (e.g. semantic-backport)")
  .requiredOption("--branch <branch>", "Target branch to repair")
  .requiredOption("--contract <path>", "BehaviorContract JSON candidate")
  .requiredOption("--proof-metadata <path>", "ExecutableProof metadata JSON")
  .requiredOption("--repair-proposal <path>", "RepairProposal JSON")
  .requiredOption("--patch <path>", "Exact repair patch")
  .option("--keep-workspace", "Keep the isolated repaired workspace for debugging")
  .action(async (opts: {
    fixture: string;
    branch: string;
    contract: string;
    proofMetadata: string;
    repairProposal: string;
    patch: string;
    keepWorkspace: boolean;
  }) => {
    let scenario;
    try {
      scenario = getScenario(opts.fixture, REPO_ROOT);
    } catch (err) {
      console.error(`Error: ${String(err)}`);
      process.exit(3);
    }

    try {
      const report = await verifyRepair(scenario, {
        fixture: opts.fixture,
        branch: opts.branch,
        contractPath: resolve(REPO_ROOT, opts.contract),
        proofMetadataPath: resolve(REPO_ROOT, opts.proofMetadata),
        repairProposalPath: resolve(REPO_ROOT, opts.repairProposal),
        patchPath: resolve(REPO_ROOT, opts.patch),
        keepWorkspace: opts.keepWorkspace,
      });

      process.stdout.write(formatRepairReport(report));

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

await program.parseAsync(process.argv);
