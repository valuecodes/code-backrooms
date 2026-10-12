import type { SourceFile } from "@repo/parser";

import { analysisFailed } from "~/analyse";
import type { AnalyseResponse, Analysis } from "~/analyse";

// The page's side of the analysis worker, free of React so a fake worker
// can drive it in tests.

/** What the client uses of a `Worker`. */
type AnalysisWorker = {
  readonly postMessage: (files: readonly SourceFile[]) => void;
  readonly terminate: () => void;
  onmessage: ((event: MessageEvent<AnalyseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/** The real worker, a module chunk of its own on this origin. */
const createAnalysisWorker = (): AnalysisWorker =>
  new Worker(new URL("./analyse.worker.ts", import.meta.url), {
    type: "module",
  });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Analyses `files` in a worker and calls `onResult` once with the analysis,
 * or with a failed one if the worker cannot start, throws or crashes.
 * Returns a cancel: after it, nothing is delivered and the worker is gone.
 */
const startAnalysis = (
  files: readonly SourceFile[],
  createWorker: () => AnalysisWorker,
  onResult: (analysis: Analysis) => void
): (() => void) => {
  let done = false;
  let worker: AnalysisWorker | null = null;
  const finish = (analysis: Analysis) => {
    if (done) {
      return;
    }
    done = true;
    worker?.terminate();
    onResult(analysis);
  };
  const fail = (error: unknown) =>
    finish(
      analysisFailed(
        `the repository could not be analysed: ${messageOf(error)}`
      )
    );
  try {
    worker = createWorker();
    worker.onmessage = ({ data }) =>
      finish("analysis" in data ? data.analysis : analysisFailed(data.error));
    worker.onerror = (event) => fail(event.message);
    worker.postMessage(files);
  } catch (error) {
    // Delivered later, like a worker's answer, so callers see one shape.
    queueMicrotask(() => fail(error));
  }
  return () => {
    done = true;
    worker?.terminate();
  };
};

export { createAnalysisWorker, startAnalysis };
export type { AnalysisWorker };
