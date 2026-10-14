import { describe, expect, it } from "vitest";

import { createStatsWindow } from "./stats-window";

const info = (calls: number) => ({
  render: { calls, triangles: calls * 100 },
  memory: { geometries: 40, textures: 6 },
});

describe("createStatsWindow", () => {
  it("samples nothing before the window has passed", () => {
    const stats = createStatsWindow(500);
    expect(stats.tick(1000, info(1))).toBeNull();
    expect(stats.tick(1250, info(2))).toBeNull();
    expect(stats.tick(1499, info(3))).toBeNull();
  });

  it("samples the last frame's counts and the mean frame time at the edge", () => {
    const stats = createStatsWindow(500);
    stats.tick(1000, info(1));
    stats.tick(1250, info(2));
    stats.tick(1400, info(3));
    expect(stats.tick(1500, info(4))).toEqual({
      calls: 4,
      triangles: 400,
      geometries: 40,
      textures: 6,
      frameMs: 125,
    });
  });

  it("starts a new window after each sample", () => {
    const stats = createStatsWindow(500);
    stats.tick(0, info(1));
    expect(stats.tick(500, info(2))).not.toBeNull();
    expect(stats.tick(900, info(3))).toBeNull();
    expect(stats.tick(1000, info(4))).toMatchObject({ calls: 4, frameMs: 250 });
  });
});
