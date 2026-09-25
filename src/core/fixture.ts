/**
 * Fixture workspace management.
 *
 * Creates isolated temporary directories per run, clones the Git bundle
 * into them, and checks out the requested branch. Never touches the source
 * bundle or any file outside the temporary directory.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "./runner.js";

export interface WorkspaceInfo {
  /** Absolute path to the isolated working directory. */
  dir: string;
  /** HEAD commit SHA after checkout. */
  commitSha: string;
}

/**
 * Resolve the absolute path to a fixture bundle.
 * Looks for `<repoRoot>/fixtures/<bundleName>.bundle`.
 */
export function resolveBundlePath(repoRoot: string, bundleName: string): string {
  return join(repoRoot, "fixtures", `${bundleName}.bundle`);
}

/**
 * Confirm the bundle file exists and is readable.
 * Returns the resolved absolute path or throws with a clear message.
 */
export async function requireBundle(bundlePath: string): Promise<string> {
  const abs = resolve(bundlePath);
  try {
    await stat(abs);
  } catch {
    throw new Error(`Fixture bundle not found: ${abs}`);
  }
  return abs;
}

/**
 * Create an isolated workspace, clone the bundle, and check out the branch.
 *
 * The workspace is a fresh tmpdir. Nothing in the source repo is mutated.
 */
export async function createWorkspace(
  bundlePath: string,
  branch: string
): Promise<WorkspaceInfo> {
  const abs = await requireBundle(bundlePath);

  // Create a fresh temp directory
  const dir = await mkdtemp(join(tmpdir(), "portproof-"));

  // Clone from the bundle
  const cloneResult = await runProcess("git", ["clone", abs, "."], { cwd: dir });
  if (cloneResult.exitCode !== 0) {
    await safeCleanup(dir);
    throw new WorkspaceError(
      `git clone failed (exit ${String(cloneResult.exitCode)}): ${cloneResult.stderr}`,
      "CLONE_FAILED"
    );
  }

  // Check out the requested branch
  const checkoutResult = await runProcess("git", ["checkout", branch], { cwd: dir });
  if (checkoutResult.exitCode !== 0) {
    await safeCleanup(dir);
    // A non-zero checkout usually means the branch does not exist
    throw new WorkspaceError(
      `Branch "${branch}" not found in bundle (exit ${String(checkoutResult.exitCode)}): ${checkoutResult.stderr}`,
      "BRANCH_NOT_FOUND"
    );
  }

  // Record the HEAD commit SHA
  const revResult = await runProcess("git", ["rev-parse", "HEAD"], { cwd: dir });
  if (revResult.exitCode !== 0) {
    await safeCleanup(dir);
    throw new WorkspaceError(
      `git rev-parse failed: ${revResult.stderr}`,
      "REV_PARSE_FAILED"
    );
  }

  const commitSha = revResult.stdout.trim();
  return { dir, commitSha };
}

/** Remove the workspace directory, silencing any errors. */
export async function safeCleanup(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort — do not mask real errors
  }
}

/** Structured error for workspace setup failures. */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BUNDLE_NOT_FOUND"
      | "CLONE_FAILED"
      | "BRANCH_NOT_FOUND"
      | "REV_PARSE_FAILED"
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}
