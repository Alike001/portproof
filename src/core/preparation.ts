import { runProcess } from "./runner.js";
import type { CommandSpec, PreparationCommandResult, PreparationResult } from "./types.js";

const PREPARATION_TIMEOUT_MS = 5 * 60_000;

export interface PreparationExecution {
  result: PreparationResult;
  targetCommitUnchanged: boolean;
  failureReason?: string;
}

function commandResult(
  command: CommandSpec,
  process: Awaited<ReturnType<typeof runProcess>>
): PreparationCommandResult {
  return {
    command: command.command,
    args: command.args,
    exitCode: process.exitCode,
    passed: process.exitCode === 0,
    durationMs: process.durationMs,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

/** Execute user-owned preparation in order, stopping at the first failure. */
export async function prepareRepository(
  workspaceDir: string,
  targetCommitSha: string,
  commands: readonly CommandSpec[]
): Promise<PreparationExecution> {
  const results: PreparationCommandResult[] = [];
  for (const spec of commands) {
    const process = await runProcess(spec.command, spec.args, {
      cwd: workspaceDir,
      timeoutMs: PREPARATION_TIMEOUT_MS,
    });
    const result = commandResult(spec, process);
    results.push(result);
    if (!result.passed) break;
  }

  // Ignore untracked/ignored generated artifacts while detecting any change
  // to files already tracked by the selected target commit.
  const trackedStatus = await runProcess(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: workspaceDir }
  );
  const trackedFilesUnchanged =
    trackedStatus.exitCode === 0 && trackedStatus.stdout.trim().length === 0;

  const head = await runProcess("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: workspaceDir,
  });
  const targetCommitUnchanged =
    head.exitCode === 0 && head.stdout.trim().toLowerCase() === targetCommitSha.toLowerCase();

  const commandsPassed = results.length === commands.length && results.every((result) => result.passed);
  const passed = commandsPassed && trackedFilesUnchanged && targetCommitUnchanged;

  let failureReason: string | undefined;
  if (!commandsPassed) {
    const failed = results.find((result) => !result.passed);
    failureReason = failed?.exitCode === null
      ? `Preparation command ${JSON.stringify(failed.command)} did not complete normally`
      : `Preparation command ${JSON.stringify(failed?.command ?? "unknown")} failed with exit ${String(failed?.exitCode)}`;
  } else if (!trackedFilesUnchanged) {
    failureReason = "Repository preparation modified tracked files in the isolated target checkout";
  } else if (!targetCommitUnchanged) {
    failureReason = "Repository preparation changed the selected target commit";
  }

  return {
    result: { commands: results, passed, trackedFilesUnchanged },
    targetCommitUnchanged,
    ...(failureReason !== undefined && { failureReason }),
  };
}
