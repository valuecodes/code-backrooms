import type { Point } from "@repo/types";
import { describe, expect, it } from "vitest";

import { roomAt, roomRects } from "./locate";
import type { RoomRect } from "./locate";
import { presets } from "./presets";
import { generateWorld } from "./world-generator";

const centre = ({ rect }: RoomRect): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

const only = (rects: readonly RoomRect[], id: string): RoomRect => {
  const room = rects.find((candidate) => candidate.id === id);
  if (room === undefined) {
    throw new Error(`No room "${id}" in the layout`);
  }
  return room;
};

describe("roomAt", () => {
  const world = generateWorld({ seed: 3, graph: presets.linear });
  const rects = roomRects(world.layout.rooms);

  it("finds the start room, corridors and nothing outside", () => {
    expect(roomAt(rects, world.built.start, null)?.id).toBe("a");
    const corridors = rects.filter((room) => room.kind === "corridor");
    expect(corridors.length).toBeGreaterThan(0);
    expect(
      corridors.map((corridor) => roomAt(rects, centre(corridor), null)?.id)
    ).toEqual(corridors.map((corridor) => corridor.id));
    expect(roomAt(rects, { x: 10_000, z: 10_000 }, "a")).toBeNull();
  });

  it("prefers the current room where two footprints touch", () => {
    // Two rooms that share the point on their common edge.
    const first = only(rects, "a");
    const second: RoomRect = {
      id: "twin",
      kind: "room",
      rect: {
        minX: first.rect.maxX,
        maxX: first.rect.maxX + 4,
        minZ: first.rect.minZ,
        maxZ: first.rect.maxZ,
      },
    };
    const edge = { x: first.rect.maxX, z: centre(first).z };
    const both = [first, second];
    expect(roomAt(both, edge, null)?.id).toBe("a");
    expect(roomAt(both, edge, "twin")?.id).toBe("twin");
    expect(roomAt(both, edge, "a")?.id).toBe("a");
    expect(roomAt(both, edge, "elsewhere")?.id).toBe("a");
  });
});
