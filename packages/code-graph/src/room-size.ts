import type { RoomSize } from "@repo/types";
import { GRID, ROOM_SIZE_CLASSES } from "@repo/world-generator/config";

type RoomDimensions = {
  readonly width: number;
  readonly depth: number;
  readonly size: RoomSize;
};

/** No room grows past the largest size class, whatever its degree. */
const MAX_EXTENT = ROOM_SIZE_CLASSES.large.max;

const sizeOf = (width: number): RoomSize => {
  if (width >= ROOM_SIZE_CLASSES.large.min) {
    return "large";
  }
  return width >= ROOM_SIZE_CLASSES.medium.min ? "medium" : "small";
};

/**
 * Grows the smaller side until the perimeter reaches `perimeter`, within
 * MAX_EXTENT. Sizing is a heuristic: whether the openings really fit is
 * decided by the layout.
 */
const growToPerimeter = (
  width: number,
  depth: number,
  perimeter: number
): readonly [number, number] => {
  let w = width;
  let d = depth;
  while (2 * (w + d) < perimeter && (w < MAX_EXTENT || d < MAX_EXTENT)) {
    if (w <= d && w < MAX_EXTENT) {
      w += GRID;
    } else {
      d += GRID;
    }
  }
  return [w, d];
};

/** A module hub starts at a fixed medium footprint and grows with its doors. */
const HUB_EXTENT = 8;

/**
 * Hubs get plenty of wall per door: their neighbours are whole units that
 * have to fit side by side along the hub's walls.
 */
const HUB_PERIMETER_PER_DOOR = 10;

const hubDimensions = (degree: number): RoomDimensions => {
  const [w, d] = growToPerimeter(
    HUB_EXTENT,
    HUB_EXTENT,
    degree * HUB_PERIMETER_PER_DOOR
  );
  return { width: w, depth: d, size: sizeOf(w) };
};

export { hubDimensions };
