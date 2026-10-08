import { describe, expect, it } from "vitest";

import { presets } from "./presets";
import { generateWorld } from "./world-generator";

describe("generateWorld", () => {
  it("generates 15 rooms by default, with colliders and doorways", () => {
    const world = generateWorld({ seed: 12_345 });
    expect(world.graph.rooms).toHaveLength(15);
    expect(world.built.rooms.length).toBeGreaterThanOrEqual(15);
    expect(world.built.doorways.length).toBeGreaterThanOrEqual(14);
    expect(world.built.colliders.length).toBeGreaterThan(0);
  });

  it("is stable for a seed and differs across seeds", () => {
    expect(generateWorld({ seed: 1, roomCount: 12 })).toEqual(
      generateWorld({ seed: 1, roomCount: 12 })
    );
    expect(generateWorld({ seed: 1, roomCount: 12 }).layout).not.toEqual(
      generateWorld({ seed: 2, roomCount: 12 }).layout
    );
  });

  it(
    "never throws for a random graph over many seeds",
    { timeout: 30 * 1000 },
    () => {
      for (let seed = 1; seed <= 150; seed += 1) {
        expect(() =>
          generateWorld({ seed, roomCount: 10 + (seed % 11) })
        ).not.toThrow();
      }
    }
  );

  it("accepts an externally supplied graph", () => {
    const world = generateWorld({ seed: 3, graph: presets.branching });
    expect(world.graph).toBe(presets.branching);
    expect(world.layout.rooms.map((room) => room.id)).toEqual(
      expect.arrayContaining(["entry", "branch", "true", "false"])
    );
    expect(world.built.start).toEqual({ x: 0, z: 0 });
  });
});
