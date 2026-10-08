import type { RoomSize } from "@repo/types";
import { GRID, ROOM_SIZE_CLASSES } from "@repo/world-generator/config";

type RoomDimensions = {
  readonly width: number;
  readonly depth: number;
  readonly size: RoomSize;
};

/** Line-count bands: a function this long gets a room of this class. */
const BANDS: readonly (readonly [RoomSize, number, number])[] = [
  ["small", 1, 12],
  ["medium", 13, 40],
  ["large", 41, 200],
];

/** No room grows past the largest size class, whatever its degree. */
const MAX_EXTENT = ROOM_SIZE_CLASSES.large.max;

/**
 * Walls host roughly one door per 8 m of perimeter (the same heuristic the
 * random graph generator uses for room capacity).
 */
const PERIMETER_PER_DOOR = 8;

const snap = (value: number): number => Math.round(value / GRID) * GRID;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const bandOf = (lineCount: number): readonly [RoomSize, number, number] => {
  const band = BANDS.find(([, , hi]) => lineCount <= hi);
  return band ?? BANDS.at(-1) ?? ["large", 41, 200];
};

const sizeOf = (width: number): RoomSize => {
  if (width >= ROOM_SIZE_CLASSES.large.min) {
    return "large";
  }
  return width >= ROOM_SIZE_CLASSES.medium.min ? "medium" : "small";
};

/**
 * Grows the smaller side until the perimeter can plausibly host `degree`
 * doors, within MAX_EXTENT. Sizing is a heuristic: whether the doors really
 * fit is decided by the layout.
 */
const growForDoors = (
  width: number,
  depth: number,
  degree: number
): readonly [number, number] => {
  let w = width;
  let d = depth;
  const fits = () => Math.floor((2 * (w + d)) / PERIMETER_PER_DOOR) >= degree;
  while (!fits() && (w < MAX_EXTENT || d < MAX_EXTENT)) {
    if (w <= d && w < MAX_EXTENT) {
      w += GRID;
    } else {
      d += GRID;
    }
  }
  return [w, d];
};

/**
 * Deterministic room footprint for a function: the size class comes from its
 * length, the exact extent from where in the band it falls, and the degree
 * (distinct neighbours) can only make it larger.
 */
const roomDimensions = (lineCount: number, degree: number): RoomDimensions => {
  const [band, lo, hi] = bandOf(Math.max(1, lineCount));
  const { min, max } = ROOM_SIZE_CLASSES[band];
  const t = clamp((Math.max(1, lineCount) - lo) / (hi - lo), 0, 1);
  const width = snap(min + t * (max - min));
  const depth = snap(Math.max(min, 0.75 * width));
  const [w, d] = growForDoors(width, depth, degree);
  return { width: w, depth: d, size: sizeOf(w) };
};

/** A module hub starts at a fixed medium footprint and grows with its doors. */
const HUB_EXTENT = 8;

const hubDimensions = (degree: number): RoomDimensions => {
  const [w, d] = growForDoors(HUB_EXTENT, HUB_EXTENT, degree);
  return { width: w, depth: d, size: sizeOf(w) };
};

export { hubDimensions, roomDimensions };
