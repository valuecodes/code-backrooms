import type { BuiltArea, RoomData } from "@repo/types";
import { WALL_HEIGHT } from "@repo/world-generator/config";

/** Distance between fluorescent panels in the ceiling grid. */
const LIGHT_SPACING = 4;
/** How far below the ceiling the fixture body hangs. */
const FIXTURE_DROP = 0.04;
/** Where the light itself sits, well clear of the fixture and ceiling. */
const LIGHT_DROP = 0.3;

type FixturePoint = {
  readonly x: number;
  readonly z: number;
  /** Ceiling height at this fixture. */
  readonly ceiling: number;
};

/** Fixture centres on a grid roughly LIGHT_SPACING apart, centred in the room. */
const fixturePositions = (room: RoomData): readonly FixturePoint[] => {
  const columns = Math.max(1, Math.round(room.width / LIGHT_SPACING));
  const rows = Math.max(1, Math.round(room.depth / LIGHT_SPACING));
  const stepX = room.width / columns;
  const stepZ = room.depth / rows;
  const [cx, y, cz] = room.position;
  const positions: FixturePoint[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({
        x: cx - room.width / 2 + stepX * (column + 0.5),
        z: cz - room.depth / 2 + stepZ * (row + 0.5),
        ceiling: y + WALL_HEIGHT,
      });
    }
  }
  return positions;
};

/** Each area's fixtures, worked out once: an area never changes once built. */
const fixturesByArea = new WeakMap<BuiltArea, readonly FixturePoint[]>();

/** Every fixture of an area's rooms, in room order. */
const areaFixtures = (area: BuiltArea): readonly FixturePoint[] => {
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

export { areaFixtures, FIXTURE_DROP, fixturePositions, LIGHT_DROP };
export type { FixturePoint };
