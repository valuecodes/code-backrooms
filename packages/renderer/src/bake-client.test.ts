import { describe, expect, it } from "vitest";

import type { BakedLightmap, BakeJob } from "./bake";
import { createBakeQueue } from "./bake-client";
import type { BakeRequest, BakeResponse, BakeWorker } from "./bake-client";

const JOB: BakeJob = {
  layout: { width: 1, height: 1, texel: 0.25, faces: [], solids: [] },
  lights: [],
};

const LIGHTMAP: BakedLightmap = {
  width: 1,
  height: 1,
  data: new Uint16Array(4),
};

/** Workers the test answers by hand; every one the queue made, in order. */
const fakeWorkers = (options: { readonly failToStart?: boolean } = {}) => {
  const made: {
    worker: BakeWorker;
    posted: BakeRequest[];
    terminated: boolean;
  }[] = [];
  const create = (): BakeWorker => {
    if (options.failToStart === true) {
      throw new Error("blocked by CSP");
    }
    const entry = {
      posted: [] as BakeRequest[],
      terminated: false,
      worker: {
        postMessage: (request: BakeRequest) => {
          entry.posted.push(request);
        },
        terminate: () => {
          entry.terminated = true;
        },
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      } as BakeWorker,
    };
    made.push(entry);
    return entry.worker;
  };
  const last = () => {
    const entry = made.at(-1);
    if (entry === undefined) {
      throw new Error("no worker made");
    }
    return entry;
  };
  return {
    made,
    create,
    last,
    reply: (data: BakeResponse) =>
      last().worker.onmessage?.({ data } as MessageEvent<BakeResponse>),
    crash: () => last().worker.onerror?.({ message: "boom" } as ErrorEvent),
    garble: () =>
      last().worker.onmessageerror?.(new MessageEvent("messageerror")),
  };
};

const collect = () => {
  const results: (string | null)[] = [];
  const onDone =
    (name: string) =>
    (lightmap: BakedLightmap | null): void => {
      results.push(lightmap === null ? null : name);
    };
  return { results, onDone };
};

/** Lets queued microtasks run. */
const settle = () => Promise.resolve();

describe("createBakeQueue", () => {
  it("bakes one job at a time, in order, on one worker", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    queue.request(JOB, onDone("b"));
    expect(fake.last().posted.map(({ id }) => id)).toEqual([0]);
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    expect(fake.last().posted.map(({ id }) => id)).toEqual([0, 1]);
    fake.reply({ id: 1, lightmap: LIGHTMAP });
    expect(results).toEqual(["a", "b"]);
    expect(fake.made).toHaveLength(1);
  });

  it("drops a waiting job that was cancelled", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    const cancel = queue.request(JOB, onDone("b"));
    cancel();
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    expect(fake.last().posted.map(({ id }) => id)).toEqual([0]);
    expect(results).toEqual(["a"]);
  });

  it("stops the worker for a cancelled running job; the next gets a new one", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    const cancel = queue.request(JOB, onDone("a"));
    queue.request(JOB, onDone("b"));
    cancel();
    expect(fake.made[0]?.terminated).toBe(true);
    expect(fake.made).toHaveLength(2);
    expect(fake.last().posted.map(({ id }) => id)).toEqual([1]);
    fake.reply({ id: 1, lightmap: LIGHTMAP });
    expect(results).toEqual(["b"]);
  });

  it("ignores an answer for any job but the running one", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    fake.reply({ id: 7, lightmap: LIGHTMAP });
    expect(results).toEqual([]);
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    expect(results).toEqual(["a"]);
  });

  it("fails the job on an error answer and replaces the worker", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    queue.request(JOB, onDone("b"));
    fake.reply({ id: 0, error: "out of memory" });
    expect(results).toEqual([null]);
    expect(fake.made[0]?.terminated).toBe(true);
    expect(fake.made).toHaveLength(2);
    fake.reply({ id: 1, lightmap: LIGHTMAP });
    expect(results).toEqual([null, "b"]);
  });

  it("fails the job when the worker crashes or garbles, and goes on", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    queue.request(JOB, onDone("b"));
    queue.request(JOB, onDone("c"));
    fake.crash();
    fake.garble();
    fake.reply({ id: 2, lightmap: LIGHTMAP });
    expect(results).toEqual([null, null, "c"]);
    expect(fake.made).toHaveLength(3);
  });

  it("replaces a worker that broke while idle", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    fake.crash();
    queue.request(JOB, onDone("b"));
    expect(fake.made).toHaveLength(2);
    fake.reply({ id: 1, lightmap: LIGHTMAP });
    expect(results).toEqual(["a", "b"]);
  });

  it("fails a job whose worker cannot start, later, like an answer", async () => {
    const fake = fakeWorkers({ failToStart: true });
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    expect(results).toEqual([]);
    await settle();
    expect(results).toEqual([null]);
  });

  it("delivers nothing after dispose, and takes new jobs after", () => {
    const fake = fakeWorkers();
    const queue = createBakeQueue(fake.create);
    const { results, onDone } = collect();
    queue.request(JOB, onDone("a"));
    queue.request(JOB, onDone("b"));
    queue.dispose();
    expect(fake.made[0]?.terminated).toBe(true);
    fake.reply({ id: 0, lightmap: LIGHTMAP });
    expect(results).toEqual([]);
    queue.request(JOB, onDone("c"));
    fake.reply({ id: 2, lightmap: LIGHTMAP });
    expect(results).toEqual(["c"]);
  });
});
