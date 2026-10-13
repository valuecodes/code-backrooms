import type { BakedLightmap, BakeJob } from "./bake";

// The page's side of the bake worker, free of React so a fake worker can
// drive it in tests.

type BakeRequest = { readonly id: number; readonly job: BakeJob };

type BakeResponse =
  | { readonly id: number; readonly lightmap: BakedLightmap }
  | { readonly id: number; readonly error: string };

/** What the queue uses of a `Worker`. */
type BakeWorker = {
  readonly postMessage: (request: BakeRequest) => void;
  readonly terminate: () => void;
  onmessage: ((event: MessageEvent<BakeResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

/** Called once per request: the lightmap, or null when the bake failed. */
type BakeDone = (lightmap: BakedLightmap | null) => void;

type BakeQueue = {
  /** Queues a bake; the returned cancel guarantees `onDone` is not called. */
  readonly request: (job: BakeJob, onDone: BakeDone) => () => void;
  /** Cancels every job and stops the worker; a later request starts afresh. */
  readonly dispose: () => void;
};

/** The real worker, a module chunk of its own on this origin. */
const createBakeWorker = (): BakeWorker =>
  new Worker(new URL("./bake.worker.ts", import.meta.url), {
    type: "module",
  });

type Job = {
  readonly id: number;
  readonly job: BakeJob;
  readonly onDone: BakeDone;
};

/**
 * Bakes one job at a time, in order, on one worker made when first needed
 * and kept between jobs. Cancelling a waiting job drops it; cancelling the
 * running one stops the worker, and the next job starts a fresh one. A
 * worker that crashes, cannot start or answers garbled fails its job and is
 * replaced. An answer for any job but the running one is dropped.
 */
const createBakeQueue = (createWorker: () => BakeWorker): BakeQueue => {
  const waiting: Job[] = [];
  let running: Job | null = null;
  let worker: BakeWorker | null = null;
  let nextId = 0;

  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };

  const finish = (id: number, lightmap: BakedLightmap | null) => {
    if (running?.id !== id) {
      return;
    }
    const { onDone } = running;
    running = null;
    if (lightmap === null) {
      stopWorker();
    }
    onDone(lightmap);
    pump();
  };

  const start = (): BakeWorker => {
    const created = createWorker();
    created.onmessage = ({ data }) =>
      finish(data.id, "lightmap" in data ? data.lightmap : null);
    // A broken worker goes even when idle, so the next job gets a new one.
    const fail = () => {
      if (worker === created) {
        stopWorker();
      }
      if (running !== null) {
        finish(running.id, null);
      }
    };
    created.onerror = fail;
    created.onmessageerror = fail;
    return created;
  };

  const pump = () => {
    if (running !== null) {
      return;
    }
    const next = waiting.shift();
    if (next === undefined) {
      return;
    }
    running = next;
    try {
      worker ??= start();
      worker.postMessage({ id: next.id, job: next.job });
    } catch {
      // Failed later, like a worker's answer, so callers see one shape.
      queueMicrotask(() => finish(next.id, null));
    }
  };

  return {
    request: (job, onDone) => {
      const entry: Job = { id: nextId, job, onDone };
      nextId += 1;
      waiting.push(entry);
      pump();
      return () => {
        const index = waiting.indexOf(entry);
        if (index !== -1) {
          waiting.splice(index, 1);
          return;
        }
        if (running === entry) {
          running = null;
          stopWorker();
          pump();
        }
      };
    },
    dispose: () => {
      waiting.length = 0;
      running = null;
      stopWorker();
    },
  };
};

export { createBakeQueue, createBakeWorker };
export type { BakeDone, BakeQueue, BakeRequest, BakeResponse, BakeWorker };
