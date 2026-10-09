import type { WallSide } from "@repo/types";
import { describe, expect, it } from "vitest";

import { fullWallPorts } from "./candidates";
import { cluster } from "./cluster-world";
import { footprintOf, orient } from "./units";
import type { Orientation } from "./units";

const origin = { x: 10, z: 20 };

const rectOf = (orientation: Orientation, roomId: string) =>
  orient(cluster, orientation, origin).rooms.find((room) => room.id === roomId)
    ?.rect;

describe("orient", () => {
  it("keeps the template as drawn when hung off a south wall", () => {
    const oriented = orient(cluster, "south", origin);
    expect(oriented.rect).toEqual({ minX: 10, maxX: 14, minZ: 20, maxZ: 29 });
    expect(rectOf("south", "step")).toEqual({
      minX: 10,
      maxX: 14,
      minZ: 20,
      maxZ: 24,
    });
    expect(oriented.rooms[0]).toMatchObject({ id: "step", entry: "north" });
    expect(oriented.rooms[1]?.entry).toBeUndefined();
    expect(oriented.ports).toEqual([
      { roomId: "step", wall: "north", lo: 10, hi: 14 },
      { roomId: "call", wall: "east", lo: 24, hi: 27, reservedFor: "callee" },
      { roomId: "call", wall: "west", lo: 24, hi: 27, reservedFor: "other" },
    ]);
    expect(oriented.portals).toEqual([
      { id: "return:fn", roomId: "ret", wall: "south", along: 12 },
    ]);
    expect(oriented.entryRoomId).toBe("step");
  });

  it("rotates the column so its entry faces the anchor", () => {
    const cases: readonly (readonly [
      Orientation,
      WallSide,
      { minX: number; maxX: number; minZ: number; maxZ: number },
      WallSide,
      readonly [number, number],
      WallSide,
      number,
    ])[] = [
      // orientation, entry wall, step rect, callee port wall and span, portal wall and along
      [
        "north",
        "south",
        { minX: 10, maxX: 14, minZ: 25, maxZ: 29 },
        "west",
        [22, 25],
        "north",
        12,
      ],
      [
        "east",
        "west",
        { minX: 10, maxX: 14, minZ: 20, maxZ: 24 },
        "north",
        [14, 17],
        "east",
        22,
      ],
      [
        "west",
        "east",
        { minX: 15, maxX: 19, minZ: 20, maxZ: 24 },
        "south",
        [12, 15],
        "west",
        22,
      ],
    ];
    for (const [
      orientation,
      entry,
      step,
      portWall,
      [lo, hi],
      wall,
      along,
    ] of cases) {
      const oriented = orient(cluster, orientation, origin);
      expect(oriented.rooms[0], `off a ${orientation} wall`).toMatchObject({
        rect: step,
        entry,
      });
      expect(oriented.ports[1], `off a ${orientation} wall`).toEqual({
        roomId: "call",
        wall: portWall,
        lo,
        hi,
        reservedFor: "callee",
      });
      expect(oriented.portals[0], `off a ${orientation} wall`).toEqual({
        id: "return:fn",
        roomId: "ret",
        wall,
        along,
      });
      const offGrid = oriented.rooms.flatMap((room) =>
        Object.values(room.rect).filter((value) => value % 0.5 !== 0)
      );
      expect(offGrid, `off a ${orientation} wall`).toEqual([]);
    }
    expect(orient(cluster, "east", origin).rect).toEqual({
      minX: 10,
      maxX: 19,
      minZ: 20,
      maxZ: 24,
    });
  });

  it("declares every template door on both sides", () => {
    const oriented = orient(cluster, "east", origin);
    const doors = Object.fromEntries(
      oriented.rooms.map((room) => [room.id, room.doors])
    );
    expect(doors.step).toEqual([{ wall: "east", targetRoomId: "call" }]);
    expect(doors.call).toEqual([
      { wall: "west", targetRoomId: "step" },
      { wall: "east", targetRoomId: "ret" },
    ]);
    expect(doors.ret).toEqual([{ wall: "west", targetRoomId: "call" }]);
  });

  it("rejects a template door between rooms that do not touch", () => {
    const broken = {
      ...cluster,
      doors: [{ from: "step", to: "ret" }],
    };
    expect(() => orient(broken, "south", origin)).toThrow(/do not share/);
  });

  it("swaps the footprint for east and west walls", () => {
    expect(footprintOf(cluster, "south")).toEqual({ width: 4, depth: 9 });
    expect(footprintOf(cluster, "west")).toEqual({ width: 9, depth: 4 });
  });
});

describe("fullWallPorts", () => {
  it("offers the whole of each wall", () => {
    expect(fullWallPorts("r", { minX: 1, maxX: 5, minZ: 2, maxZ: 8 })).toEqual([
      { roomId: "r", wall: "north", lo: 1, hi: 5 },
      { roomId: "r", wall: "south", lo: 1, hi: 5 },
      { roomId: "r", wall: "east", lo: 2, hi: 8 },
      { roomId: "r", wall: "west", lo: 2, hi: 8 },
    ]);
  });
});
