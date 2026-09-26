import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import type { DemoRunSnapshot } from "../src/server/types.js";

const repositoryRoot = resolve(process.cwd());

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function waitForTerminal(baseUrl: string, runId: string): Promise<DemoRunSnapshot> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/demo/runs/${runId}`);
    const snapshot = await json<DemoRunSnapshot>(response);
    if (snapshot.status === "COMPLETED" || snapshot.status === "ERROR") return snapshot;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 50));
  }
  throw new Error("Timed out waiting for demo run");
}

describe("prepared demo API", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { app } = createApp(repositoryRoot);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListen) => server.once("listening", resolveListen));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolveClose();
      })
    );
  });

  it("runs the real broken proof, then proves the real repair with one frozen hash", async () => {
    const createResponse = await fetch(`${baseUrl}/api/demo/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "semantic-backport", branch: "demo-clean-backport" }),
    });
    expect(createResponse.status).toBe(202);
    const { runId } = await json<{ runId: string }>(createResponse);

    const before = await waitForTerminal(baseUrl, runId);
    expect(before.status).toBe("COMPLETED");
    expect(before.report?.verdict).toBe("NOT_PROVEN");
    expect(before.report?.semantic.proof.observed).toEqual({ timeout: 5000 });
    expect(before.report?.mechanical.workspace?.clean).toBe(true);
    expect(before.events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      "VALIDATING_CONTRACT",
      "CHECKING_TESTS",
      "RUNNING_PROOF",
      "COMPLETED",
    ]));
    const beforeHash = before.report?.evidence?.executableProof.sourceProofHash;
    const verificationSequence = before.events.at(-1)?.sequence ?? 0;

    const repairResponse = await fetch(`${baseUrl}/api/demo/runs/${runId}/repair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(repairResponse.status).toBe(202);

    const after = await waitForTerminal(baseUrl, runId);
    expect(after.report?.verdict).toBe("PROVEN");
    expect(after.report?.semantic.proof.observed).toEqual({ timeout: 0 });
    expect(after.report?.repair?.before?.proofHash).toBe(beforeHash);
    expect(after.report?.repair?.after?.proofHash).toBe(beforeHash);
    expect(after.report?.repair?.changedPaths).toEqual(["src/request.js"]);

    const repairEvents = await fetch(
      `${baseUrl}/api/demo/runs/${runId}/events?after=${String(verificationSequence)}`
    ).then((response) => response.text());
    expect(repairEvents).toContain("VALIDATING_PATCH");
    expect(repairEvents).toContain("REVERIFYING_FROZEN_PROOF");
    expect(repairEvents).not.toContain('"phase":"PREPARING"');

    const reportResponse = await fetch(`${baseUrl}/api/reports/${runId}`);
    expect(reportResponse.status).toBe(200);
    const payload = await json<{ report: { verdict: string }; bobEvidence: object }>(reportResponse);
    expect(payload.report.verdict).toBe("PROVEN");
    expect(payload.bobEvidence).toBeDefined();
  });

  it("rejects unsupported scenario and arbitrary repair input", async () => {
    const unsupported = await fetch(`${baseUrl}/api/demo/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "arbitrary-repository" }),
    });
    expect(unsupported.status).toBe(400);

    const missingRun = await fetch(`${baseUrl}/api/demo/runs/not-a-run/repair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "echo unsafe" }),
    });
    expect(missingRun.status).toBe(400);
  });
});
