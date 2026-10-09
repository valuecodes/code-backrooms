import type { Port, Rect, WallSide } from "@repo/types";

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
  /** The wall of the anchor the new unit (or its corridor) hangs off. */
  readonly wall: WallSide;
  /** The stretch of that wall it attaches to, and the room that wall belongs to. */
  readonly port: Port;
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

/** The whole of each wall: how a plain room offers itself as an anchor. */
const fullWallPorts = (roomId: string, rect: Rect): readonly Port[] =>
  WALLS.map((wall) => {
    const cross = other(OUTWARD[wall].axis);
    return { roomId, wall, lo: lo(rect, cross), hi: hi(rect, cross) };
  });

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

/**
 * Every placement of `room` off one port of `anchor`, with or without a
 * corridor. A direct contact overlaps the port by at least MIN_SHARED; a
 * corridor starts inside it.
 */
const candidatesOnWall = (
  rng: Rng,
  anchor: Rect,
  port: Port,
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
  const anchorLo = port.lo;
  const anchorHi = port.hi;
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
      port,
      room: makeRect(axis, roomLo, roomHi, start, start + across),
      corridor: null,
    }));
  }

  // The corridor end must sit fully inside the port, and the room's wall
  // must fully contain the corridor's other end.
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
      port,
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
 * Candidate placements next to `anchor`, in priority order. Each call of the
 * returned function yields the next wall-and-length batch (every port on
 * that wall; a wall without one yields nothing and draws no random numbers),
 * so a caller that finds a fit early never builds the rest. `footprint`
 * gives the extent to place for a wall, which a rotated unit changes.
 */
const candidateBatches = (
  rng: Rng,
  anchor: Rect,
  ports: readonly Port[],
  footprint: (wall: WallSide) => Extent
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
    return ports
      .filter((port) => port.wall === wall)
      .flatMap((port) =>
        candidatesOnWall(rng, anchor, port, footprint(wall), wall, length)
      );
  };
};

export { candidateBatches, fullWallPorts, hi, lo, makeRect, OUTWARD };
export type { Axis, Candidate, Extent };
