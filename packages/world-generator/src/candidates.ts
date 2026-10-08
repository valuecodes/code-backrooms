import type { Rect, WallSide } from "@repo/types";

import { CORRIDOR_LENGTHS, CORRIDOR_WIDTH, GRID, MIN_SHARED } from "./config";
import { snap } from "./fit";
import { pick, shuffle } from "./random";
import type { Rng } from "./random";

type Axis = "x" | "z";

type Extent = {
  readonly width: number;
  readonly depth: number;
};

type Candidate = {
  /** The wall of the anchor room the new room (or its corridor) hangs off. */
  readonly wall: WallSide;
  readonly room: Rect;
  readonly corridor: Rect | null;
};

const WALLS: readonly WallSide[] = ["north", "south", "east", "west"];

/** Direction a room moves when it steps out through `wall`. */
const OUTWARD: Record<
  WallSide,
  { readonly axis: Axis; readonly sign: 1 | -1 }
> = {
  north: { axis: "z", sign: -1 },
  south: { axis: "z", sign: 1 },
  east: { axis: "x", sign: 1 },
  west: { axis: "x", sign: -1 },
};

const other = (axis: Axis): Axis => (axis === "x" ? "z" : "x");
const lo = (rect: Rect, axis: Axis): number =>
  axis === "x" ? rect.minX : rect.minZ;
const hi = (rect: Rect, axis: Axis): number =>
  axis === "x" ? rect.maxX : rect.maxZ;
const extent = (size: Extent, axis: Axis): number =>
  axis === "x" ? size.width : size.depth;

const makeRect = (
  axis: Axis,
  alongLo: number,
  alongHi: number,
  crossLo: number,
  crossHi: number
): Rect =>
  axis === "x"
    ? { minX: alongLo, maxX: alongHi, minZ: crossLo, maxZ: crossHi }
    : { minZ: alongLo, maxZ: alongHi, minX: crossLo, maxX: crossHi };

/** Every grid value in [min, max]; both ends are on the grid already. */
const gridRange = (min: number, max: number): number[] =>
  Array.from(
    { length: Math.max(0, Math.round((max - min) / GRID) + 1) },
    (_, i) => min + i * GRID
  );

/**
 * Every grid position in [min, max], searched exhaustively. Half the time the
 * named alignments (corners, centre) go first for tidy layouts; otherwise the
 * order is random, so a retry with a new seed explores a different packing.
 */
const offsets = (
  rng: Rng,
  named: readonly number[],
  min: number,
  max: number
): number[] => {
  const rest = shuffle(rng, gridRange(min, max));
  const values = rng() < 0.5 ? [...named.map(snap), ...rest] : rest;
  return [...new Set(values)].filter((value) => value >= min && value <= max);
};

/** Mixes direct doorways with hallways instead of always taking the shortest fit. */
const lengthOrder = (rng: Rng): number[] => {
  if (rng() < 0.6) {
    return [0, ...CORRIDOR_LENGTHS];
  }
  const first = pick(rng, CORRIDOR_LENGTHS);
  return [first, 0, ...CORRIDOR_LENGTHS.filter((length) => length !== first)];
};

/** Every placement of `room` off one wall of `anchor`, with or without a corridor. */
const candidatesOnWall = (
  rng: Rng,
  anchor: Rect,
  room: Extent,
  wall: WallSide,
  length: number
): Candidate[] => {
  const { axis, sign } = OUTWARD[wall];
  const cross = other(axis);
  const edge = sign > 0 ? hi(anchor, axis) : lo(anchor, axis);
  const along = extent(room, axis);
  const across = extent(room, cross);
  const near = edge + sign * length;
  const far = near + sign * along;
  const [roomLo, roomHi] = sign > 0 ? [near, far] : [far, near];
  const [corridorLo, corridorHi] = sign > 0 ? [edge, near] : [near, edge];
  const anchorLo = lo(anchor, cross);
  const anchorHi = hi(anchor, cross);
  const anchorMid = (anchorLo + anchorHi) / 2;

  // Corner-first packing keeps the middle of long walls free for later
  // neighbours; the shuffled remainder still gives every seed its own look.
  if (length === 0) {
    return offsets(
      rng,
      [anchorLo, anchorHi - across, anchorMid - across / 2],
      anchorLo - across + MIN_SHARED,
      anchorHi - MIN_SHARED
    ).map((start) => ({
      wall,
      room: makeRect(axis, roomLo, roomHi, start, start + across),
      corridor: null,
    }));
  }

  // The corridor end must sit fully inside the anchor wall, and the room's
  // wall must fully contain the corridor's other end.
  return offsets(
    rng,
    [anchorLo, anchorHi - CORRIDOR_WIDTH, anchorMid - CORRIDOR_WIDTH / 2],
    anchorLo,
    anchorHi - CORRIDOR_WIDTH
  ).flatMap((corridorStart) => {
    const corridorMid = corridorStart + CORRIDOR_WIDTH / 2;
    // Hang the room outward, away from the anchor's middle.
    const outward =
      corridorMid < anchorMid
        ? corridorStart + CORRIDOR_WIDTH - across
        : corridorStart;
    return offsets(
      rng,
      [outward, corridorMid - across / 2],
      corridorStart + CORRIDOR_WIDTH - across,
      corridorStart
    ).map((start) => ({
      wall,
      room: makeRect(axis, roomLo, roomHi, start, start + across),
      corridor: makeRect(
        axis,
        corridorLo,
        corridorHi,
        corridorStart,
        corridorStart + CORRIDOR_WIDTH
      ),
    }));
  });
};

/**
 * Candidate placements of `room` next to `anchor`, in priority order. Each
 * call of the returned function yields the next wall-and-length batch, so a
 * caller that finds a fit early never builds the rest.
 */
const candidateBatches = (
  rng: Rng,
  anchor: Rect,
  room: Extent
): (() => Candidate[] | null) => {
  const walls = shuffle(rng, WALLS);
  const lengths = lengthOrder(rng);
  let index = 0;
  return () => {
    const length = lengths[Math.floor(index / walls.length)];
    const wall = walls[index % walls.length];
    if (length === undefined || wall === undefined) {
      return null;
    }
    index += 1;
    return candidatesOnWall(rng, anchor, room, wall, length);
  };
};

export { candidateBatches, hi, lo, makeRect, OUTWARD };
export type { Axis, Candidate };
