import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureNext, storeFor } from "./use-area-world";
import { generateAll, nextFrame } from "./use-generate-all";
import type { Schedule } from "./use-generate-all";
import { codeGraphOf } from "./world-from-code";

/** A schedule run by hand: `flush` runs what is queued, one at a time. */
const manual = () => {
  const queue: (() => void)[] = [];
  const schedule: Schedule = (run) => {
    queue.push(run);
    return () => {
      const index = queue.indexOf(run);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    };
  };
  const flush = () => queue.shift()?.();
  return { schedule, flush, queued: () => queue.length };
};

/** A step that reports true `times` times, counting its calls. */
const counter = (times: number) => {
  let calls = 0;
  const step = () => {
    calls += 1;
    return calls < times;
  };
  return { step, calls: () => calls };
};

describe("generateAll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one step per scheduled callback", () => {
    const { schedule, flush, queued } = manual();
    const { step, calls } = counter(5);
    generateAll(step, schedule);
    expect(calls()).toBe(0);
    flush();
    expect(calls()).toBe(1);
    expect(queued()).toBe(1);
    flush();
    expect(calls()).toBe(2);
  });

  it("stops when the step reports false", () => {
    const { schedule, flush, queued } = manual();
    const { step, calls } = counter(3);
    generateAll(step, schedule);
    flush();
    flush();
    flush();
    expect(calls()).toBe(3);
    expect(queued()).toBe(0);
  });

  it("cancel stops further steps", () => {
    const { schedule, flush, queued } = manual();
    const { step, calls } = counter(5);
    const cancel = generateAll(step, schedule);
    flush();
    cancel();
    expect(queued()).toBe(0);
    flush();
    expect(calls()).toBe(1);
  });

  it("nextFrame falls back to a zero-delay timer without a visible document", () => {
    vi.useFakeTimers();
    const { step, calls } = counter(3);
    generateAll(step, nextFrame);
    expect(calls()).toBe(0);
    vi.advanceTimersByTime(0);
    expect(calls()).toBe(1);
    vi.runAllTimers();
    expect(calls()).toBe(3);
  });

  it("drives a code world's store to every area generated", () => {
    const { codeGraph } = codeGraphOf("repo");
    const source = storeFor(1, {
      codeGraph,
      codeError: null,
      eager: false,
      rooms: 15,
      preset: null,
    });
    if (source.store === null) {
      throw new Error(source.error);
    }
    const { store } = source;
    const { schedule, flush, queued } = manual();
    generateAll(() => ensureNext(store), schedule);
    while (queued() > 0) {
      flush();
    }
    const { world } = store.snapshot();
    expect(world.pending).toEqual([]);
    expect(world.areas.length).toBeGreaterThan(1);
  });
});
