import type { Rect, RoomData } from "@repo/types";
import { WALL_HEIGHT } from "@repo/world-generator/config";

import type { AreaRooms } from "./lightmap-layout";

/** Distance between fluorescent panels in the ceiling grid. */
const LIGHT_SPACING = 4;
/** Where the light itself sits, well clear of the fixture and ceiling. */
const LIGHT_DROP = 0.3;

/** Each fixture's light: shared by the live pool and the bake. */
const LIGHT_INTENSITY = 14;
const LIGHT_COLOR = "#fff2cc";
const LIGHT_DISTANCE = 9;

type FixturePoint = {
  readonly x: number;
  readonly z: number;
  /** Ceiling height at this fixture. */
  readonly ceiling: number;
  /** The floor of its room: who stands on it sees the fixture unblocked. */
  readonly room: Rect;
};

/** Fixture centres on a grid roughly LIGHT_SPACING apart, centred in the room. */
const fixturePositions = (room: RoomData): readonly FixturePoint[] => {
  const columns = Math.max(1, Math.round(room.width / LIGHT_SPACING));
  const rows = Math.max(1, Math.round(room.depth / LIGHT_SPACING));
  const stepX = room.width / columns;
  const stepZ = room.depth / rows;
  const [cx, y, cz] = room.position;
  const floor: Rect = {
    minX: cx - room.width / 2,
    maxX: cx + room.width / 2,
    minZ: cz - room.depth / 2,
    maxZ: cz + room.depth / 2,
  };
  const positions: FixturePoint[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({
        x: cx - room.width / 2 + stepX * (column + 0.5),
        z: cz - room.depth / 2 + stepZ * (row + 0.5),
        ceiling: y + WALL_HEIGHT,
        room: floor,
      });
    }
  }
  return positions;
};

/** Each area's fixtures, worked out once: an area never changes once built. */
const fixturesByArea = new WeakMap<AreaRooms, readonly FixturePoint[]>();

/** Every fixture of an area's rooms, in room order. */
const areaFixtures = (area: AreaRooms): readonly FixturePoint[] => {
  const known = fixturesByArea.get(area);
  if (known !== undefined) {
    return known;
  }
  const created = area.built.rooms.flatMap((built) =>
    fixturePositions(built.room)
  );
  fixturesByArea.set(area, created);
  return created;
};

export {
  areaFixtures,
  fixturePositions,
  LIGHT_COLOR,
  LIGHT_DISTANCE,
  LIGHT_DROP,
  LIGHT_INTENSITY,
};
export type { FixturePoint };
