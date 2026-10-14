import type { AreaWorld, Rect } from "@repo/types";
import { AREA_GAP } from "@repo/world-generator/areas";

// Where the whole-world map draws the areas not generated yet. They have no
// place in the world, so they wait on a shelf above it, zone by zone.

/** A ghost's footprint and the gap between ghosts, in metres. */
const GHOST_WIDTH = 20;
const GHOST_DEPTH = 12;
const GHOST_GAP = 4;
/** Ghosts in a row at least, however narrow the world is so far. */
const MIN_COLUMNS = 8;

/**
 * The areas not generated yet (pending, then failed), in the groups the
 * shelf rows them in: each zone's in its own order (its hub first), then
 * every other, sorted.
 */
const ghostGroups = (world: AreaWorld): readonly (readonly string[])[] => {
  const ghosts = new Set([...world.pending, ...world.failed]);
  const zoned = new Set(world.zones.flatMap((zone) => zone.areas));
  return [
    ...world.zones.map((zone) => zone.areas.filter((id) => ghosts.has(id))),
    [...ghosts].filter((id) => !zoned.has(id)).toSorted(),
  ].filter((group) => group.length > 0);
};

/**
 * Every ghost's slot: rows on a shelf AREA_GAP above every generated area
 * (-Z), unloaded ones included, as wide as they are, each zone's ghosts
 * starting a row of their own. A function of the world alone; the shelf
 * moves out as the world grows towards it, and a ghost leaves it once its
 * area is generated.
 */
const ghostSlots = (world: AreaWorld): ReadonlyMap<string, Rect> => {
  const rects = [...world.areas, ...world.unloaded].map((area) => area.bounds);
  const minX = rects.length === 0 ? 0 : Math.min(...rects.map((r) => r.minX));
  const maxX = rects.length === 0 ? 0 : Math.max(...rects.map((r) => r.maxX));
  const top =
    (rects.length === 0 ? 0 : Math.min(...rects.map((r) => r.minZ))) - AREA_GAP;
  const columns = Math.max(
    MIN_COLUMNS,
    Math.floor((maxX - minX + GHOST_GAP) / (GHOST_WIDTH + GHOST_GAP))
  );
  const slots = new Map<string, Rect>();
  let row = 0;
  for (const group of ghostGroups(world)) {
    group.forEach((id, index) => {
      const left = minX + (index % columns) * (GHOST_WIDTH + GHOST_GAP);
      const bottom =
        top - (row + Math.floor(index / columns)) * (GHOST_DEPTH + GHOST_GAP);
      slots.set(id, {
        minX: left,
        maxX: left + GHOST_WIDTH,
        minZ: bottom - GHOST_DEPTH,
        maxZ: bottom,
      });
    });
    row += Math.ceil(group.length / columns);
  }
  return slots;
};

export { ghostSlots };
