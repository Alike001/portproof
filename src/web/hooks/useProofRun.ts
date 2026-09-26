import { useCallback, useEffect, useReducer, useRef } from "react";
import { getRun, startDemo, startRepair } from "../lib/api.js";
import { initialProofRunState, proofRunReducer } from "../state/proofRunReducer.js";
import type { DemoEvent } from "../types.js";

export function useProofRun(autoStart: boolean) {
  const [state, dispatch] = useReducer(proofRunReducer, initialProofRunState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const autoStartedRef = useRef(false);

  const listen = useCallback((runId: string, afterSequence = 0) => {
    eventSourceRef.current?.close();
    const source = new EventSource(
      `/api/demo/runs/${encodeURIComponent(runId)}/events?after=${String(afterSequence)}`
    );
    eventSourceRef.current = source;
    source.addEventListener("phase", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as DemoEvent;
      dispatch({ type: "PHASE_RECEIVED", event });
      if (event.phase === "COMPLETED") {
        source.close();
        void getRun(runId)
          .then((snapshot) => {
            if (!snapshot.report) throw new Error("Completed run did not return a report.");
            dispatch({ type: "REPORT_RECEIVED", report: snapshot.report });
          })
          .catch((error: unknown) => {
            dispatch({ type: "FAILED", message: String(error) });
          });
      }
      if (event.phase === "ERROR") {
        source.close();
        dispatch({ type: "FAILED", message: "The deterministic run could not complete." });
      }
    });
    source.onerror = () => {
      source.close();
      void getRun(runId)
        .then((snapshot) => {
          if (snapshot.report) {
            dispatch({ type: "REPORT_RECEIVED", report: snapshot.report });
          } else if (snapshot.status === "ERROR") {
            dispatch({ type: "FAILED", message: snapshot.error ?? "Run failed." });
          }
        })
        .catch(() => {
          dispatch({ type: "FAILED", message: "Lost the run event stream." });
        });
    };
  }, []);

  const run = useCallback(async () => {
    try {
      const result = await startDemo();
      dispatch({ type: "RUN_ACCEPTED", runId: result.runId });
      listen(result.runId);
    } catch (error) {
      dispatch({ type: "FAILED", message: String(error) });
    }
  }, [listen]);

  const repair = useCallback(async () => {
    if (!state.runId) return;
    try {
      await startRepair(state.runId);
      dispatch({ type: "REPAIR_ACCEPTED" });
      const lastSequence = state.phaseHistory.reduce(
        (highest, event) => Math.max(highest, event.sequence),
        0
      );
      listen(state.runId, lastSequence);
    } catch (error) {
      dispatch({ type: "FAILED", message: String(error) });
    }
  }, [listen, state.phaseHistory, state.runId]);

  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void run();
    }
  }, [autoStart, run]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  return { state, run, repair };
}
