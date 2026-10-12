import { describe, expect, it } from "vitest";

import { backdropWorld } from "./backdrop-world";

describe("backdropWorld", () => {
  it("builds the demo's entrance and nothing else yet", () => {
    const world = backdropWorld();
    expect(world).not.toBeNull();
    expect(world?.areas.map((area) => area.id)).toEqual([world?.entry]);
    expect(world?.areas[0]?.built.rooms.length).toBeGreaterThan(0);
  });

  it("is the same world every time", () => {
    const [first, second] = [backdropWorld(), backdropWorld()];
    expect(first?.seed).toBe(second?.seed);
    expect(first?.areas[0]?.built.start).toEqual(second?.areas[0]?.built.start);
  });
});
