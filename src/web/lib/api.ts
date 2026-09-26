import type { DemoEvidenceBundle, DemoReportResponse, DemoRunSnapshot } from "../types.js";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with status ${String(response.status)}`);
  }
  return response.json() as Promise<T>;
}

export async function startDemo(): Promise<{ runId: string }> {
  return requestJson("/api/demo/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario: "semantic-backport",
      branch: "demo-clean-backport",
    }),
  });
}

export async function startRepair(runId: string): Promise<void> {
  await requestJson(`/api/demo/runs/${encodeURIComponent(runId)}/repair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function getRun(runId: string): Promise<DemoRunSnapshot> {
  return requestJson(`/api/demo/runs/${encodeURIComponent(runId)}`);
}

export function getReport(runId: string): Promise<DemoReportResponse> {
  return requestJson(`/api/reports/${encodeURIComponent(runId)}`);
}

export function getDemoEvidence(): Promise<DemoEvidenceBundle> {
  return requestJson("/api/demo/evidence");
}
