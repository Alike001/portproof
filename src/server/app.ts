import express from "express";
import { join } from "node:path";
import { z } from "zod";
import { DemoService } from "./demo-service.js";
import type { DemoEvent } from "./types.js";

const runRequestSchema = z.strictObject({
  scenario: z.literal("semantic-backport").optional(),
  branch: z.literal("demo-clean-backport").optional(),
});
const emptyRequestSchema = z.strictObject({});

function writeEvent(response: express.Response, event: DemoEvent): void {
  response.write(`id: ${String(event.sequence)}\n`);
  response.write(`event: phase\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createApp(repositoryRoot: string, service = new DemoService(repositoryRoot)) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb", strict: true }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "portproof" });
  });

  app.get("/api/demo/evidence", async (_request, response, next) => {
    try {
      response.json(await service.getEvidence());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/demo/run", (request, response) => {
    const parsed = runRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "Only the prepared semantic-backport demo is supported." });
      return;
    }
    const runId = service.startVerification();
    response.status(202).json({ runId, status: "QUEUED" });
  });

  app.get("/api/demo/runs/:runId", (request, response) => {
    const snapshot = service.getSnapshot(request.params.runId);
    if (!snapshot) {
      response.status(404).json({ error: "Demo run not found." });
      return;
    }
    response.json(snapshot);
  });

  app.get("/api/demo/runs/:runId/events", (request, response) => {
    const snapshot = service.getSnapshot(request.params.runId);
    if (!snapshot) {
      response.status(404).json({ error: "Demo run not found." });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const afterQuery = request.query.after;
    const parsedAfter = Number.parseInt(typeof afterQuery === "string" ? afterQuery : "0", 10);
    const after = Number.isSafeInteger(parsedAfter) && parsedAfter >= 0 ? parsedAfter : 0;
    for (const event of snapshot.events.filter((item) => item.sequence > after)) {
      writeEvent(response, event);
    }
    if (snapshot.status === "COMPLETED" || snapshot.status === "ERROR") {
      response.end();
      return;
    }

    const unsubscribe = service.store.subscribe(request.params.runId, (event) => {
      writeEvent(response, event);
      if (event.phase === "COMPLETED" || event.phase === "ERROR") response.end();
    });
    request.on("close", unsubscribe);
  });

  app.post("/api/demo/runs/:runId/repair", (request, response) => {
    if (!emptyRequestSchema.safeParse(request.body ?? {}).success) {
      response.status(400).json({ error: "Repair inputs are fixed for the prepared demo." });
      return;
    }
    try {
      service.startRepair(request.params.runId);
      response.status(202).json({ runId: request.params.runId, status: "QUEUED" });
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : "Repair rejected." });
    }
  });

  app.get("/api/reports/:runId", async (request, response, next) => {
    try {
      const payload = await service.getReport(request.params.runId);
      if (!payload) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reports/:runId/raw", async (request, response, next) => {
    try {
      const payload = await service.getReport(request.params.runId);
      if (!payload) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.setHeader("Content-Disposition", `attachment; filename=portproof-${request.params.runId}.json`);
      response.json(payload.report);
    } catch (error) {
      next(error);
    }
  });

  const webRoot = join(repositoryRoot, "dist", "web");
  app.use(express.static(webRoot, {
    index: false,
    setHeaders: (response) => response.setHeader("X-Content-Type-Options", "nosniff"),
  }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(join(webRoot, "index.html"));
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });
  // Express identifies error middleware by its four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error("PortProof server error", error);
    response.status(500).json({ error: "PortProof server error." });
  });

  return { app, service };
}
