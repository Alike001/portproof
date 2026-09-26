import { validatePublicBoundary } from "../core/executable-proof.js";
import type { ExecutableProof } from "../core/types.js";
import type { LanguageAdapter } from "./types.js";

const OBSERVATION_PREFIX = "PORTPROOF_OBSERVED ";

function parseScalar(value: string): string | number | boolean | null {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

/**
 * Parse the JS/TS adapter observation protocol.
 * Preferred form: PORTPROOF_OBSERVED {"field":value}
 * Legacy-compatible form: PORTPROOF_OBSERVED field=value
 */
export function parseJavaScriptObservation(stdout: string, expected: unknown): unknown {
  const line = stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(OBSERVATION_PREFIX));
  if (!line) return null;
  const payload = line.slice(OBSERVATION_PREFIX.length).trim();
  if (!payload) return null;

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    const separator = payload.indexOf("=");
    if (separator <= 0) return null;
    const key = payload.slice(0, separator).trim();
    const rawValue = payload.slice(separator + 1).trim();
    if (!key || !rawValue) return null;
    const value = parseScalar(rawValue);
    if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
      return { [key]: value };
    }
    return value;
  }
}

export const javascriptAdapter: LanguageAdapter = {
  id: "javascript",
  validateExecutableProof(
    copiedProofPath: string,
    workspaceRoot: string,
    metadata: ExecutableProof
  ): Promise<void> {
    return validatePublicBoundary(copiedProofPath, workspaceRoot, metadata);
  },
  parseObservation: parseJavaScriptObservation,
};
