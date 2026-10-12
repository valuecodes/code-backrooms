import { describe, expect, it } from "vitest";

import { analysisFailed } from "./analyse";
import type { AnalyseResponse, Analysis } from "./analyse";
import { startAnalysis } from "./analyse-client";
import type { AnalysisWorker } from "./analyse-client";

const FILES = [{ path: "a.ts", source: "function a() {}" }];

const ANALYSIS: Analysis = {
  code: { codeGraph: null, error: "stand-in" },
  areaLinks: [],
  sourceSeed: 7,
};

/** A worker the test answers by hand. */
const fakeWorker = (options: { readonly throwOnPost?: boolean } = {}) => {
  const state = { posted: [] as unknown[], terminated: 0 };
  const worker: AnalysisWorker = {
    postMessage: (files) => {
      if (options.throwOnPost === true) {
        throw new Error("could not clone");
      }
      state.posted.push(files);
    },
    terminate: () => {
      state.terminated += 1;
    },
    onmessage: null,
    onerror: null,
  };
  return {
    worker,
    state,
    reply: (data: AnalyseResponse) =>
      worker.onmessage?.({ data } as MessageEvent<AnalyseResponse>),
    crash: (message: string) => worker.onerror?.({ message } as ErrorEvent),
  };
};

const collect = () => {
  const results: Analysis[] = [];
  return { results, onResult: (analysis: Analysis) => results.push(analysis) };
};

/** Lets queued microtasks run. */
const settle = () => Promise.resolve();

describe("startAnalysis", () => {
  it("posts the files and delivers the answer once, then terminates", () => {
    const fake = fakeWorker();
    const { results, onResult } = collect();
    startAnalysis(FILES, () => fake.worker, onResult);
    expect(fake.state.posted).toEqual([FILES]);
    fake.reply({ analysis: ANALYSIS });
    fake.reply({ analysis: ANALYSIS });
    expect(results).toEqual([ANALYSIS]);
    expect(fake.state.terminated).toBe(1);
  });

  it("drops an answer that arrives after cancel", () => {
    const fake = fakeWorker();
    const { results, onResult } = collect();
    const cancel = startAnalysis(FILES, () => fake.worker, onResult);
    cancel();
    fake.reply({ analysis: ANALYSIS });
    expect(results).toEqual([]);
    expect(fake.state.terminated).toBe(1);
  });

  it("passes on the worker's own error answer", () => {
    const fake = fakeWorker();
    const { results, onResult } = collect();
    startAnalysis(FILES, () => fake.worker, onResult);
    fake.reply({ error: "bad graph" });
    expect(results).toEqual([analysisFailed("bad graph")]);
  });

  it("turns a crashed worker into a failed analysis", () => {
    const fake = fakeWorker();
    const { results, onResult } = collect();
    startAnalysis(FILES, () => fake.worker, onResult);
    fake.crash("out of memory");
    expect(results).toEqual([
      analysisFailed("the repository could not be analysed: out of memory"),
    ]);
  });

  it("turns a worker that cannot start into a failed analysis", async () => {
    const { results, onResult } = collect();
    startAnalysis(
      FILES,
      () => {
        throw new Error("blocked by CSP");
      },
      onResult
    );
    expect(results).toEqual([]);
    await settle();
    expect(results).toEqual([
      analysisFailed("the repository could not be analysed: blocked by CSP"),
    ]);
  });

  it("turns a failed post into a failed analysis and stops the worker", async () => {
    const fake = fakeWorker({ throwOnPost: true });
    const { results, onResult } = collect();
    startAnalysis(FILES, () => fake.worker, onResult);
    await settle();
    expect(results).toEqual([
      analysisFailed("the repository could not be analysed: could not clone"),
    ]);
    expect(fake.state.terminated).toBe(1);
  });

  it("delivers nothing for a start failure cancelled first", async () => {
    const { results, onResult } = collect();
    const cancel = startAnalysis(
      FILES,
      () => {
        throw new Error("blocked");
      },
      onResult
    );
    cancel();
    await settle();
    expect(results).toEqual([]);
  });
});
