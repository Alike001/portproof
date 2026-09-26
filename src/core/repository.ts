import { mkdtemp, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { safeCleanup } from "./fixture.js";
import { runProcess } from "./runner.js";
import type { RepositoryInput, RepositoryProvenance, WorkspaceStatusResult } from "./types.js";

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

async function resolveCommit(repositoryPath: string, ref: string): Promise<string> {
  const result = await runProcess("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: repositoryPath,
  });
  const sha = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new RepositoryError(`Git ref ${JSON.stringify(ref)} could not be resolved to a commit`);
  }
  return sha;
}

export async function inspectRepository(input: RepositoryInput): Promise<{
  root: string;
  provenance: RepositoryProvenance;
}> {
  const requested = resolve(input.repositoryPath);
  try {
    if (!(await stat(requested)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new RepositoryError(`Repository path is unavailable: ${String(error)}`);
  }
  const root = await realpath(requested);
  const inside = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    throw new RepositoryError("Repository path is not a Git working tree");
  }
  const sourceSha = await resolveCommit(root, input.sourceRef);
  const targetSha = await resolveCommit(root, input.targetRef);
  return {
    root,
    provenance: {
      repository: basename(root) || "repository",
      source: { ref: input.sourceRef, commitSha: sourceSha },
      target: { ref: input.targetRef, commitSha: targetSha },
      test: input.test,
    },
  };
}

export async function createRepositoryWorkspace(
  repositoryRoot: string,
  targetSha: string
): Promise<{ dir: string; commitSha: string; status: WorkspaceStatusResult }> {
  const dir = await mkdtemp(join(tmpdir(), "portproof-repo-"));
  const clone = await runProcess(
    "git",
    ["clone", "--no-hardlinks", "--no-checkout", "--", repositoryRoot, "."],
    { cwd: dir }
  );
  if (clone.exitCode !== 0) {
    await safeCleanup(dir);
    throw new RepositoryError(`Isolated Git clone failed: ${clone.stderr}`);
  }
  const checkout = await runProcess("git", ["checkout", "--detach", targetSha], { cwd: dir });
  if (checkout.exitCode !== 0) {
    await safeCleanup(dir);
    throw new RepositoryError(`Target checkout failed: ${checkout.stderr}`);
  }
  const head = await resolveCommit(dir, "HEAD");
  if (head !== targetSha) {
    await safeCleanup(dir);
    throw new RepositoryError("Isolated checkout did not resolve to the selected target commit");
  }
  const process = await runProcess("git", ["status", "--porcelain=v1"], { cwd: dir });
  const status: WorkspaceStatusResult = {
    command: "git",
    args: ["status", "--porcelain=v1"],
    exitCode: process.exitCode,
    clean: process.exitCode === 0 && process.stdout.length === 0,
    durationMs: process.durationMs,
    stdout: process.stdout,
    stderr: process.stderr,
  };
  if (!status.clean) {
    await safeCleanup(dir);
    throw new RepositoryError("Isolated target checkout is not clean");
  }
  return { dir, commitSha: head, status };
}
