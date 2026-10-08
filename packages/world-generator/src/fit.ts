import type { Rect, WallSide } from "@repo/types";

import { GRID, MIN_GAP, MIN_SHARED } from "./config";

const snap = (value: number): number => Math.round(value / GRID) * GRID;

/** Strict: rects that only touch do not overlap. */
const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Largest axis separation: 0 when flush, negative when overlapping. */
const rectGap = (a: Rect, b: Rect): number => {
  const dx = Math.max(b.minX - a.maxX, a.minX - b.maxX);
  const dz = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
  return Math.max(dx, dz);
};

type SharedEdge = {
  /** The wall of `a` that `b` sits flush against. */
  readonly wall: WallSide;
  /** Length of the contact along that wall. */
  readonly overlap: number;
};

/** Exact comparisons are safe: every edge sits on the GRID lattice. */
const sharedEdge = (a: Rect, b: Rect): SharedEdge | null => {
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  if (overlapZ > 0) {
    if (a.maxX === b.minX) {
      return { wall: "east", overlap: overlapZ };
    }
    if (a.minX === b.maxX) {
      return { wall: "west", overlap: overlapZ };
    }
  }
  if (overlapX > 0) {
    if (a.maxZ === b.minZ) {
      return { wall: "south", overlap: overlapX };
    }
    if (a.minZ === b.maxZ) {
      return { wall: "north", overlap: overlapX };
    }
  }
  return null;
};

type Placed = ReadonlyMap<string, Rect>;

type Fit = {
  /** Placed graph neighbours that end up flush with room for a door. */
  readonly doorsTo: readonly string[];
};

const NONE: ReadonlySet<string> = new Set();

/**
 * A candidate may touch the rects it was built against (`touching`) and its
 * own graph `neighbours`, the latter only with enough contact for a door; the
 * caller then commits that door, so no touch goes undocumented. Everything
 * else keeps MIN_GAP of air, and nothing may overlap.
 */
const fit = (
  candidate: Rect,
  placed: Placed,
  touching: ReadonlySet<string>,
  neighbours: ReadonlySet<string>
): Fit | null => {
  const doorsTo: string[] = [];
  for (const [id, other] of placed) {
    if (rectsOverlap(candidate, other)) {
      return null;
    }
    if (touching.has(id) || rectGap(candidate, other) >= MIN_GAP) {
      continue;
    }
    const edge = sharedEdge(candidate, other);
    if (neighbours.has(id) && edge !== null && edge.overlap >= MIN_SHARED) {
      doorsTo.push(id);
      continue;
    }
    return null;
  }
  return { doorsTo };
};

export { fit, NONE, rectGap, rectsOverlap, sharedEdge, snap };
export type { Placed };
