import type { AreaWorld } from "@repo/types";
import type { AreaStore } from "@repo/world-generator/area-store";

// Which areas to unload as the player walks a large world: the built areas
// past a budget, least recently visited first, never one the player stands
// in or is about to land in. An unloaded area comes back the same, where it
// was, the next time anything needs it (`AreaStore.ensure`).

/**
 * Built areas kept at most, unless more are pinned. §18 of the plan: about
 * 1.4 MB of heap per built area, and GPU buffers per area seen.
 */
const MAX_LOADED_AREAS = 12;

/**
 * The area of a room: its unit's area, or for a corridor (not a unit) the
 * area whose layout has it; undefined for no room or an unknown one.
 */
const areaOfRoom = (
  world: AreaWorld,
  roomId: string | null
): string | undefined =>
  roomId === null
    ? undefined
    : (world.areaOf.get(roomId) ??
      world.areas.find((area) =>
        area.layout.rooms.some((room) => room.id === roomId)
      )?.id);

/**
 * The areas never unloaded now: the entry (the player's start), the area
 * `here` and the area of every unit given (where the next teleport, step or
 * Backspace lands). Bounded by what the caller passes, never by the stack.
 */
const pinnedAreas = (
  world: AreaWorld,
  here: string | null,
  units: readonly string[]
): ReadonlySet<string> =>
  new Set([
    world.entry,
    ...(here === null ? [] : [here]),
    ...units.flatMap((unit) => areaOfRoom(world, unit) ?? []),
  ]);

type EvictionInput = {
  /** The built areas. */
  readonly loaded: readonly string[];
  readonly pinned: ReadonlySet<string>;
  /** When each area was last visited or loaded; higher is more recent. */
  readonly seen: ReadonlyMap<string, number>;
  readonly budget: number;
};

/**
 * The areas to unload to get down to `budget`: unpinned ones, least
 * recently seen first. When the pins alone are over the budget they win:
 * every unpinned area goes, and no pinned one.
 */
const evictions = ({
  loaded,
  pinned,
  seen,
  budget,
}: EvictionInput): readonly string[] => {
  const over = loaded.length - budget;
  if (over <= 0) {
    return [];
  }
  return loaded
    .filter((id) => !pinned.has(id))
    .toSorted((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0))
    .slice(0, over);
};

/** What the player needs loaded now. */
type Pins = {
  /** The room the player stands in, or null between rooms. */
  readonly roomId: string | null;
  /** Units a teleport or a step may land in next. */
  readonly units: readonly string[];
  /**
   * Where the next Backspace or return portal lands (the top frame's
   * caller): kept, and generated again when it was unloaded.
   */
  readonly returnUnit: string | null;
};

/**
 * Unloads `store`'s areas past `budget` each time it is called, after any
 * change: a fresh load counts as a visit, so the area just generated for
 * the portal ahead is never the first to go. Remembers the last area the
 * player stood in, for the moments they stand in none.
 */
const createUnloader = (
  store: AreaStore,
  budget = MAX_LOADED_AREAS
): ((pins: Pins) => void) => {
  const seen = new Map<string, number>();
  let tick = 0;
  let here: string | null = null;
  return ({ roomId, units, returnUnit }) => {
    const { world } = store.snapshot();
    here = areaOfRoom(world, roomId) ?? here;
    tick += 1;
    for (const { id } of world.areas) {
      if (!seen.has(id)) {
        seen.set(id, tick);
      }
    }
    if (here !== null) {
      seen.set(here, tick);
    }
    const pinned = pinnedAreas(
      world,
      here,
      returnUnit === null ? units : [...units, returnUnit]
    );
    const loaded = world.areas.map(({ id }) => id);
    for (const id of evictions({ loaded, pinned, seen, budget })) {
      store.evict(id);
      // Generated again, it counts as fresh.
      seen.delete(id);
    }
    const back = areaOfRoom(world, returnUnit);
    if (
      back !== undefined &&
      store.snapshot().world.unloaded.some(({ id }) => id === back)
    ) {
      store.ensure(back);
    }
  };
};

export { areaOfRoom, createUnloader, evictions, MAX_LOADED_AREAS, pinnedAreas };
export type { Pins };
