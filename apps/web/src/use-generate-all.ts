import { useEffect } from "react";

// Generates a whole world one area at a time, off the current task, so the
// page paints its progress between areas instead of freezing until the end.

/** Runs `run` later; returns what cancels it. */
type Schedule = (run: () => void) => () => void;

/** The next task, at once. */
const nextTask: Schedule = (run) => {
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
};

/** How long a frame may take before the next step runs without it. */
const FRAME_TIMEOUT_MS = 100;

/**
 * After the next frame has painted, while the page is visible: zero-delay
 * timers alone can run several areas inside one frame. A hidden tab gets no
 * frames, so it falls back to the next task, and a tab hidden while waiting
 * for its frame runs the step after `FRAME_TIMEOUT_MS`: either way it
 * finishes in the background.
 */
const nextFrame: Schedule = (run) => {
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    typeof requestAnimationFrame === "undefined"
  ) {
    return nextTask(run);
  }
  let ran = false;
  const once = () => {
    if (!ran) {
      ran = true;
      run();
    }
  };
  let cancelTask: (() => void) | null = null;
  const frame = requestAnimationFrame(() => {
    cancelTask = nextTask(once);
  });
  const timeout = setTimeout(once, FRAME_TIMEOUT_MS);
  return () => {
    ran = true;
    cancelAnimationFrame(frame);
    clearTimeout(timeout);
    cancelTask?.();
  };
};

/**
 * Calls `step` once per scheduled callback until it reports false; returns
 * what stops it early.
 */
const generateAll = (
  step: () => boolean,
  schedule: Schedule = nextFrame
): (() => void) => {
  let cancel = schedule(function run() {
    if (step()) {
      cancel = schedule(run);
    }
  });
  return () => cancel();
};

/** Steps `step` (`AreaView.ensureNext`) to the end while `enabled`. */
const useGenerateAll = (step: () => boolean, enabled: boolean): void => {
  useEffect(() => (enabled ? generateAll(step) : undefined), [step, enabled]);
};

export { generateAll, nextFrame, useGenerateAll };
export type { Schedule };
