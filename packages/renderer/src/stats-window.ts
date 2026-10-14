/** What the renderer drew and holds, sampled once per window. */
type RenderSample = {
  /** Draw calls of the last frame, every pass of the post-processing included. */
  readonly calls: number;
  readonly triangles: number;
  /** Geometries and textures alive on the GPU. */
  readonly geometries: number;
  readonly textures: number;
  /** Mean time between frames over the window, in milliseconds: not render cost. */
  readonly frameMs: number;
};

/** The parts of `renderer.info` a sample reads. */
type RenderInfo = {
  readonly render: { readonly calls: number; readonly triangles: number };
  readonly memory: { readonly geometries: number; readonly textures: number };
};

type StatsWindow = {
  /** Counts a frame at `now`; a sample once `everyMs` have passed, else null. */
  readonly tick: (now: number, info: RenderInfo) => RenderSample | null;
};

/** The window starts on the first tick, so nothing reads a clock up front. */
const createStatsWindow = (everyMs: number): StatsWindow => {
  let started: number | null = null;
  let frames = 0;
  return {
    tick: (now, info) => {
      // The first tick only opens the window: no frame interval precedes it.
      if (started === null) {
        started = now;
        return null;
      }
      frames += 1;
      const elapsed = now - started;
      if (elapsed < everyMs) {
        return null;
      }
      const sample = {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        frameMs: elapsed / frames,
      };
      started = now;
      frames = 0;
      return sample;
    },
  };
};

export { createStatsWindow };
export type { RenderSample };
