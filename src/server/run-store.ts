import type {
  DemoEvent,
  DemoOperation,
  DemoPhase,
  DemoRunSnapshot,
} from "./types.js";
import type { BackportProofReport } from "../core/types.js";

type Subscriber = (event: DemoEvent) => void;

interface MutableRun {
  snapshot: DemoRunSnapshot;
  subscribers: Set<Subscriber>;
}

export class DemoRunStore {
  private readonly runs = new Map<string, MutableRun>();

  create(runId: string): DemoRunSnapshot {
    const snapshot: DemoRunSnapshot = {
      runId,
      status: "QUEUED",
      operation: "VERIFY",
      phase: "PREPARING",
      events: [],
    };
    this.runs.set(runId, { snapshot, subscribers: new Set() });
    return this.copy(snapshot);
  }

  get(runId: string): DemoRunSnapshot | undefined {
    const run = this.runs.get(runId);
    return run ? this.copy(run.snapshot) : undefined;
  }

  begin(runId: string, operation: DemoOperation, phase: DemoPhase): void {
    const run = this.requireRun(runId);
    run.snapshot.status = "RUNNING";
    run.snapshot.operation = operation;
    run.snapshot.phase = phase;
  }

  emit(
    runId: string,
    operation: DemoOperation,
    phase: DemoPhase,
    verdict?: BackportProofReport["verdict"]
  ): DemoEvent {
    const run = this.requireRun(runId);
    run.snapshot.operation = operation;
    run.snapshot.phase = phase;
    const event: DemoEvent = {
      sequence: run.snapshot.events.length + 1,
      operation,
      phase,
      at: new Date().toISOString(),
      ...(verdict !== undefined && { verdict }),
    };
    run.snapshot.events.push(event);
    for (const subscriber of run.subscribers) subscriber(event);
    return event;
  }

  complete(runId: string, operation: DemoOperation, report: BackportProofReport): void {
    const run = this.requireRun(runId);
    run.snapshot.status = "COMPLETED";
    run.snapshot.report = report;
    this.emit(runId, operation, "COMPLETED", report.verdict);
  }

  fail(runId: string, operation: DemoOperation, message: string): void {
    const run = this.requireRun(runId);
    run.snapshot.status = "ERROR";
    run.snapshot.error = message;
    this.emit(runId, operation, "ERROR");
  }

  subscribe(runId: string, subscriber: Subscriber): () => void {
    const run = this.requireRun(runId);
    run.subscribers.add(subscriber);
    return () => run.subscribers.delete(subscriber);
  }

  private requireRun(runId: string): MutableRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Demo run not found");
    return run;
  }

  private copy(snapshot: DemoRunSnapshot): DemoRunSnapshot {
    return {
      ...snapshot,
      events: snapshot.events.map((event) => ({ ...event })),
    };
  }
}
