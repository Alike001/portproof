/**
 * Deterministic BehaviorContract loading, validation, and integrity hashing.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { BehaviorContract } from "./types.js";

const nonBlankString = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${field} must be a non-empty string`,
  });

/** Runtime trust boundary for model- or human-produced behavior evidence. */
export const behaviorContractSchema: z.ZodType<BehaviorContract> = z.strictObject({
  version: z.literal("1"),
  id: nonBlankString("id"),
  intent: nonBlankString("intent"),
  observable: z.strictObject({
    setup: z.record(z.string(), z.string()),
    operation: nonBlankString("operation"),
    expected: z.unknown().refine((value) => value !== undefined, {
      message: "expected is required",
    }),
  }),
});

/** Error class used for all contract loading and validation failures. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "contract";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** Read JSON exactly once and reject malformed or schema-invalid evidence. */
export async function loadBehaviorContract(path: string): Promise<BehaviorContract> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ContractError(`Behavior contract could not be read at ${path}: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ContractError(`Behavior contract contains invalid JSON: ${String(error)}`);
  }

  const result = behaviorContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContractError(
      `Behavior contract schema validation failed: ${formatValidationError(result.error)}`
    );
  }

  return result.data;
}

/**
 * Serialize JSON-compatible data with lexicographically sorted object keys.
 * Array order is preserved. The validated contract is therefore independent
 * of source-file whitespace and property order.
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContractError("Behavior contract contains a non-finite number");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new ContractError(`Behavior contract contains unsupported value type: ${typeof value}`);
}

/** Hash a validated contract's canonical representation using SHA-256. */
export function hashBehaviorContract(contract: BehaviorContract): string {
  return createHash("sha256").update(canonicalSerialize(contract), "utf8").digest("hex");
}

/** Hash exact bytes using SHA-256. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash the exact bytes of an executable proof artifact using SHA-256. */
export async function hashProofFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return hashBytes(bytes);
}
