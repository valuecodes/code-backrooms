import type { BuiltRoom, WallSegment } from "@repo/types";
import {
  DOOR_HEIGHT,
  DOOR_WIDTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from "@repo/world-generator/config";

import type { AreaRooms } from "./lightmap-layout";

// Hand-built rooms for the lighting tests: a rectangle walled on all four
// sides inside its own footprint, optionally with a door on its east or
// west wall at z = its centre.

type Side = "east" | "west";

const wall = (
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  kind: WallSegment["kind"] = "wall"
): WallSegment => ({ center: [...center], size: [...size], kind });

/** A wall along z at `x` from z0 to z1, with a door gap at `door` if given. */
const zWall = (
  x: number,
  z0: number,
  z1: number,
  door: number | null
): WallSegment[] => {
  const h = WALL_HEIGHT / 2;
  if (door === null) {
    return [
      wall([x, h, (z0 + z1) / 2], [WALL_THICKNESS, WALL_HEIGHT, z1 - z0]),
    ];
  }
  const g0 = door - DOOR_WIDTH / 2;
  const g1 = door + DOOR_WIDTH / 2;
  const lintel = WALL_HEIGHT - DOOR_HEIGHT;
  return [
    wall([x, h, (z0 + g0) / 2], [WALL_THICKNESS, WALL_HEIGHT, g0 - z0]),
    wall([x, h, (g1 + z1) / 2], [WALL_THICKNESS, WALL_HEIGHT, z1 - g1]),
    wall(
      [x, DOOR_HEIGHT + lintel / 2, door],
      [WALL_THICKNESS, lintel, DOOR_WIDTH],
      "lintel"
    ),
  ];
};

/** A room centred on (x, z), walled inside its footprint. */
const testRoom = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  doors: readonly Side[] = []
): BuiltRoom => {
  const t = WALL_THICKNESS / 2;
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  const h = WALL_HEIGHT / 2;
  return {
    room: { id, kind: "room", position: [x, 0, z], width, depth, doors: [] },
    openings: [],
    segments: [
      wall([x, h, z0 + t], [width, WALL_HEIGHT, WALL_THICKNESS]),
      wall([x, h, z1 - t], [width, WALL_HEIGHT, WALL_THICKNESS]),
      ...zWall(
        x0 + t,
        z0 + WALL_THICKNESS,
        z1 - WALL_THICKNESS,
        doors.includes("west") ? z : null
      ),
      ...zWall(
        x1 - t,
        z0 + WALL_THICKNESS,
        z1 - WALL_THICKNESS,
        doors.includes("east") ? z : null
      ),
    ],
  };
};

const areaOf = (...rooms: BuiltRoom[]): AreaRooms => ({ built: { rooms } });

export { areaOf, testRoom };
