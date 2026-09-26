import { javascriptAdapter } from "./javascript.js";
import type { LanguageAdapter } from "./types.js";

export function getLanguageAdapter(id: string): LanguageAdapter | undefined {
  return id === javascriptAdapter.id ? javascriptAdapter : undefined;
}

export type { LanguageAdapter } from "./types.js";
