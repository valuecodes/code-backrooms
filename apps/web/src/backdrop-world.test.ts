import { describe, expect, it } from "vitest";

import { backdropWorld } from "./backdrop-world";

describe("backdropWorld", () => {
  it("builds every area of the demo, starting at its entrance", () => {
    const world = backdropWorld();
    expect(world).not.toBeNull();
    expect(world?.areas[0]?.id).toBe(world?.entry);
    expect(world?.areas[0]?.built.rooms.length).toBeGreaterThan(0);
    expect(world?.pending).toEqual([]);
    expect(world?.failed).toEqual([]);
  });

  it("is the same world every time", () => {
    const [first, second] = [backdropWorld(), backdropWorld()];
    expect(first?.seed).toBe(second?.seed);
    expect(first?.areas[0]?.built.start).toEqual(second?.areas[0]?.built.start);
  });
});
