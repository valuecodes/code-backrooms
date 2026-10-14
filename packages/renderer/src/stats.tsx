import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import { createStatsWindow } from "./stats-window";
import type { RenderSample } from "./stats-window";

type RenderStatsProps = {
  /** Called once per window, never per frame, so the page can afford a render. */
  readonly onSample: (sample: RenderSample) => void;
  readonly everyMs?: number;
};

const DEFAULT_WINDOW_MS = 500;

/**
 * Samples `renderer.info` inside the Canvas while mounted. The renderer
 * resets its counts on every render call and the effect composer renders
 * several passes a frame, so it stops resetting on its own: this
 * default-priority subscriber runs before the composer's render, reads the
 * totals of the frame before and resets them.
 */
const RenderStats = ({
  onSample,
  everyMs = DEFAULT_WINDOW_MS,
}: RenderStatsProps) => {
  const get = useThree((state) => state.get);
  const sampler = useMemo(() => createStatsWindow(everyMs), [everyMs]);

  useEffect(() => {
    const { info } = get().gl;
    const before = info.autoReset;
    info.autoReset = false;
    info.reset();
    return () => {
      info.autoReset = before;
    };
  }, [get]);

  useFrame(({ gl }) => {
    const sample = sampler.tick(performance.now(), gl.info);
    if (sample !== null) {
      onSample(sample);
    }
    gl.info.reset();
  });

  return null;
};

export { RenderStats };
export type { RenderSample } from "./stats-window";
