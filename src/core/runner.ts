/**
 * Process execution utilities.
 *
 * All commands are executed via spawn with shell: false to prevent
 * shell injection. Commands must be specified as argument arrays.
 */

import { spawn } from "node:child_process";
import type { ProcessResult } from "./types.js";

/** Default per-process wall-clock timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunProcessOptions {
  /** Working directory for the child process. */
  cwd: string;
  /** Additional environment variables merged onto process.env. */
  env?: Record<string, string>;
  /** Override the default timeout. */
  timeoutMs?: number;
}

/**
 * Run a command with argument array (no shell interpolation).
 * Captures stdout, stderr, exit code, signal, and duration.
 * Never throws — returns a result whose exitCode or signal encodes failure.
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions
): Promise<ProcessResult> {
  const { cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const startMs = Date.now();

  return new Promise<ProcessResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      resolve({
        command,
        args,
        exitCode: timedOut ? null : code,
        signal: timedOut ? "SIGKILL" : signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        durationMs,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      resolve({
        command,
        args,
        exitCode: null,
        signal: (err as NodeJS.ErrnoException).code ?? "ENOENT",
        stdout: "",
        stderr: err.message,
        durationMs,
      });
    });
  });
}
