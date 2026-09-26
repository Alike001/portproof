export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    if (values.length === 1) return formatValue(values[0]);
    return JSON.stringify(value);
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "symbol") return value.description ?? "symbol";
  return "—";
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function shortHash(hash: string | null | undefined, length = 12): string {
  if (!hash) return "pending";
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}

export function objectAt(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : {};
}

export function textAt(value: unknown, key: string, fallback = "Evidence unavailable"): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : fallback;
}

export function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function stringListAt(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const nested = (value as Record<string, unknown>)[key];
  return Array.isArray(nested) ? nested.filter((item): item is string => typeof item === "string") : [];
}
