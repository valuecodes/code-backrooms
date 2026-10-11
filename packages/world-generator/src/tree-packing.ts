// Areas set apart as a tree: the entry at the origin, every other area
// beside its parent (the area it is reached from), each branch heading out
// from the entry, so the world grows from the centre in every direction.

import type { Point, Rect } from "@repo/types";

import { AREA_GAP, GRID } from "./config";
import { rectGap } from "./fit";

/** Rings of candidates round an anchor before the outward fallback. */
const MAX_RINGS = 8;
/** Metres each ring lies further out than the one before. */
const RING_STEP = 16;
/**
 * Metres between candidates along a side of a ring: fine enough that the
 * gap between two diagonal neighbours still has a candidate in it.
 */
const SLIDE_STEP = 2;

/** An area to place: its id and its bounds laid out round the origin. */
type TreeSlot = {
  readonly id: string;
  readonly rect: Rect;
};

/** A placed area: its bounds where it is, and the area it was placed beside. */
type PlacedSlot = {
  readonly id: string;
  readonly rect: Rect;
  readonly offset: Point;
  readonly anchor: string | null;
};

const gridUp = (value: number): number => Math.ceil(value / GRID - 1e-9) * GRID;
const gridDown = (value: number): number =>
  Math.floor(value / GRID + 1e-9) * GRID;
const gridRound = (value: number): number => Math.round(value / GRID) * GRID;

const moved = (rect: Rect, { x, z }: Point): Rect => ({
  minX: rect.minX + x,
  maxX: rect.maxX + x,
  minZ: rect.minZ + z,
  maxZ: rect.maxZ + z,
});

const centreOf = (rect: Rect): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

/** Clear of every placed area by AREA_GAP. */
const fits = (rect: Rect, placed: readonly PlacedSlot[]): boolean =>
  placed.every((other) => rectGap(rect, other.rect) >= AREA_GAP - 1e-9);

/**
 * The nearest placed ancestor of `id` over `parents`; the entry (the first
 * placed) when none is placed. Stops at a revisit, so a cycle cannot hang.
 */
const anchorOf = (
  id: string,
  parents: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, PlacedSlot>,
  entry: PlacedSlot
): PlacedSlot => {
  const seen = new Set([id]);
  for (
    let parent = parents.get(id);
    parent !== undefined && !seen.has(parent);
    parent = parents.get(parent)
  ) {
    const placed = byId.get(parent);
    if (placed !== undefined) {
      return placed;
    }
    seen.add(parent);
  }
  return entry;
};

/**
 * The branch `id` belongs to: the index of the ancestor (or itself) whose
 * parent is the entry among the entry's children, sorted by id so the
 * order areas come in does not matter, and their count. An area that
 * hangs off no child of the entry gets a branch past the last.
 */
const branchOf = (
  id: string,
  parents: ReadonlyMap<string, string>,
  entry: string
): { readonly index: number; readonly count: number } => {
  const children = [...parents]
    .filter(([, parent]) => parent === entry)
    .map(([child]) => child)
    .toSorted();
  const seen = new Set<string>();
  let node = id;
  while (!seen.has(node)) {
    seen.add(node);
    const parent = parents.get(node);
    if (parent === entry || parent === undefined) {
      break;
    }
    node = parent;
  }
  const index = children.indexOf(node);
  return index < 0
    ? { index: children.length, count: children.length + 1 }
    : { index, count: children.length };
};

/**
 * The unit direction an area heads in from its anchor: away from the
 * anchor's own anchor, or for an area beside the entry its branch's share
 * of the full turn (the k-th of n branches at 2πk/n).
 */
const headingOf = (
  id: string,
  anchor: PlacedSlot,
  parents: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, PlacedSlot>,
  entry: PlacedSlot
): Point => {
  const grand = anchor.anchor === null ? undefined : byId.get(anchor.anchor);
  if (anchor !== entry && grand !== undefined) {
    const from = centreOf(grand.rect);
    const to = centreOf(anchor.rect);
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length > 1e-9) {
      return { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
    }
  }
  const { index, count } = branchOf(id, parents, entry.id);
  const angle = (2 * Math.PI * index) / count;
  return { x: Math.cos(angle), z: Math.sin(angle) };
};

/** The offsets of `rect` on ring `gap` round `around`, all four sides. */
const ringOffsets = (around: Rect, rect: Rect, gap: number): Point[] => {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const offsets: Point[] = [];
  for (
    let minZ = around.minZ - depth - gap;
    minZ <= around.maxZ + gap;
    minZ += SLIDE_STEP
  ) {
    const z = gridRound(minZ - rect.minZ);
    offsets.push({ x: gridUp(around.maxX + gap - rect.minX), z });
    offsets.push({ x: gridDown(around.minX - gap - rect.maxX), z });
  }
  for (
    let minX = around.minX - width - gap;
    minX <= around.maxX + gap;
    minX += SLIDE_STEP
  ) {
    const x = gridRound(minX - rect.minX);
    offsets.push({ x, z: gridUp(around.maxZ + gap - rect.minZ) });
    offsets.push({ x, z: gridDown(around.minZ - gap - rect.maxZ) });
  }
  return offsets;
};

/**
 * Where the next area goes, given every area placed so far: beside its
 * anchor (`anchorOf`), on the nearest of MAX_RINGS rings round it that has
 * room, the candidates of a ring tried by how far they turn from the
 * area's heading (`headingOf`). With no room on any ring it goes out along
 * its heading until it clears everything. Offsets are on the grid and
 * every area stays AREA_GAP from every other. The first area keeps the
 * origin. A pure function of its arguments.
 */
const placeNext = (
  placed: readonly PlacedSlot[],
  slot: TreeSlot,
  parents: ReadonlyMap<string, string>
): PlacedSlot => {
  const [entry] = placed;
  if (entry === undefined) {
    const offset = { x: 0, z: 0 };
    return { id: slot.id, rect: slot.rect, offset, anchor: null };
  }
  const byId = new Map(placed.map((area) => [area.id, area]));
  const anchor = anchorOf(slot.id, parents, byId, entry);
  const heading = headingOf(slot.id, anchor, parents, byId, entry);
  const from = centreOf(anchor.rect);
  const own = centreOf(slot.rect);
  const turn = ({ x, z }: Point): number => {
    const dx = own.x + x - from.x;
    const dz = own.z + z - from.z;
    const length = Math.hypot(dx, dz);
    return length < 1e-9 ? 1 : 1 - (dx * heading.x + dz * heading.z) / length;
  };
  const place = (offset: Point): PlacedSlot => ({
    id: slot.id,
    rect: moved(slot.rect, offset),
    offset,
    anchor: anchor.id,
  });
  for (let ring = 0; ring < MAX_RINGS; ring += 1) {
    const candidates = ringOffsets(
      anchor.rect,
      slot.rect,
      AREA_GAP + ring * RING_STEP
    )
      .map((offset) => ({ offset, turn: turn(offset) }))
      .toSorted(
        (a, b) =>
          a.turn - b.turn || a.offset.x - b.offset.x || a.offset.z - b.offset.z
      );
    const found = candidates.find(({ offset }) =>
      fits(moved(slot.rect, offset), placed)
    );
    if (found !== undefined) {
      return place(found.offset);
    }
  }
  // Out along the heading. At `reach` the area's centre is twice its
  // diagonal and twice AREA_GAP past every placed corner, which leaves more
  // than AREA_GAP along one axis whatever the direction and the rounding.
  const reach =
    Math.max(
      ...placed.map(({ rect }) =>
        Math.hypot(
          Math.max(Math.abs(rect.minX - from.x), Math.abs(rect.maxX - from.x)),
          Math.max(Math.abs(rect.minZ - from.z), Math.abs(rect.maxZ - from.z))
        )
      )
    ) +
    2 *
      (Math.hypot(
        slot.rect.maxX - slot.rect.minX,
        slot.rect.maxZ - slot.rect.minZ
      ) +
        AREA_GAP +
        GRID);
  for (let distance = 0; ; distance += RING_STEP) {
    const at = Math.min(distance, reach);
    const offset = {
      x: gridRound(from.x + heading.x * at - own.x),
      z: gridRound(from.z + heading.z * at - own.z),
    };
    if (fits(moved(slot.rect, offset), placed) || at === reach) {
      return place(offset);
    }
  }
};

/** `placeNext` over a whole sequence: each area's offset, in order. */
const packTree = (
  slots: readonly TreeSlot[],
  parents: ReadonlyMap<string, string>
): readonly Point[] => {
  const placed: PlacedSlot[] = [];
  for (const slot of slots) {
    placed.push(placeNext(placed, slot, parents));
  }
  return placed.map((area) => area.offset);
};

export { MAX_RINGS, packTree, placeNext, RING_STEP };
export type { PlacedSlot, TreeSlot };
