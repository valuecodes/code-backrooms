import type { CodeGraph } from "@repo/code-graph";
import { codeAreaStore } from "@repo/code-graph/module-areas";
import { isZoneHub } from "@repo/code-graph/zones";
import type { AreaWorld, GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { createAreaStore } from "@repo/world-generator/area-store";
import type { AreaState, AreaStore } from "@repo/world-generator/area-store";
import { mergeAreas } from "@repo/world-generator/areas";
import { presets } from "@repo/world-generator/presets";
import type { PresetName } from "@repo/world-generator/presets";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { areaOfRoom, createUnloader } from "~/area-budget";
import type { Pins } from "~/area-budget";

// The world on screen as a store of areas: a code world generates its
// entrance at once and each module when the player first heads for it; a
// random or preset world is one area, generated at once.

type WorldOptions = {
  /** A parsed code world, or null for a random or preset one. */
  readonly codeGraph: CodeGraph | null;
  /** Why the code world could not be parsed: nothing is generated. */
  readonly codeError: string | null;
  /** Generate every module up front (`?eager=1`). */
  readonly eager: boolean;
  readonly rooms: number;
  readonly preset: PresetName | null;
};

type AreaView = {
  /** The areas generated so far, or null after an error. */
  readonly world: AreaWorld | null;
  /**
   * The same as one world, as of this moment, for the navigator: an area
   * joined since the render is there, and portals across areas land.
   */
  readonly current: () => GeneratedWorld | null;
  /** Rooms (and corridors) of every area so far. */
  readonly rooms: number;
  /**
   * Generates the area a portal leads into, unless it exists or failed;
   * an unloaded one comes back where it was.
   */
  readonly ensurePortal: (portalId: string) => void;
  /**
   * Generates the area of a unit (a choice's candidate, a frame's caller),
   * unless it exists or failed; true when the area is generated once it
   * returns, from the store as of now (a failure on this call included).
   */
  readonly ensureUnit: (unitId: string) => boolean;
  /** A choice portal's candidates, in order; none for any other portal. */
  readonly candidatesOf: (portalId: string) => readonly string[];
  /**
   * Unloads the areas past the budget that `pins` does not need, least
   * recently visited first (`createUnloader`); call after every change.
   * Does nothing when eager: every area is wanted then.
   */
  readonly unload: (pins: AreaPins) => void;
  /** Generates the first pending area; false once none is left. */
  readonly ensureNext: () => boolean;
  /** The area a portal leads into when that area could not be generated. */
  readonly failedArea: (portalId: string) => string | null;
  /** Whether a unit's area could not be generated. */
  readonly failedUnit: (unitId: string) => boolean;
  /**
   * Modules generated so far (unloaded ones too) and in all; areas of other
   * worlds count as one.
   */
  readonly modules: { readonly built: number; readonly total: number };
  /** Milliseconds the last area generated on the way took; null when eager. */
  readonly lastMs: number | null;
  /** Connections and portals not laid out and areas that failed, one line each. */
  readonly warnings: readonly string[];
  /** The message of every area that could not be generated, by area id. */
  readonly errors: ReadonlyMap<string, string>;
  readonly error: string | null;
};

/**
 * What the player needs loaded: the room they stand in, the units the
 * next step may land in, and the portal ahead (its far side and, for a
 * choice, its candidates).
 */
type AreaPins = Pins & { readonly portalId: string | null };

/** A zone's name and its module areas generated so far and in all. */
type ZoneProgress = {
  readonly name: string;
  readonly built: number;
  readonly total: number;
};

/** The one area of a random or preset world. */
const WORLD_AREA = "world";

type Source =
  | { readonly store: AreaStore; readonly error: null }
  | { readonly store: null; readonly error: string };

/**
 * The store of the world of `seed`. Generating the first area can fail (an
 * unplaceable graph); that is a value here, shown in the HUD, never thrown
 * through the renderer.
 */
const storeFor = (seed: number, options: WorldOptions): Source => {
  if (options.codeError !== null) {
    return { store: null, error: options.codeError };
  }
  try {
    if (options.codeGraph !== null) {
      const store = codeAreaStore(options.codeGraph, seed, {
        eager: options.eager,
      });
      return { store, error: null };
    }
    const store = createAreaStore({
      seed,
      entry: WORLD_AREA,
      specs: [
        {
          id: WORLD_AREA,
          units: [],
          generate: () =>
            generateWorld({
              seed,
              roomCount: options.rooms,
              graph:
                options.preset === null ? undefined : presets[options.preset],
            }),
        },
      ],
    });
    return { store, error: null };
  } catch (error) {
    return { store: null, error: String(error) };
  }
};

/**
 * One merged world per set of areas, so the same snapshot gives the same
 * object: the navigator keeps one per world.
 */
const merged = new WeakMap<AreaWorld, GeneratedWorld>();

const mergedOf = (world: AreaWorld): GeneratedWorld => {
  const known = merged.get(world);
  if (known !== undefined) {
    return known;
  }
  const created = mergeAreas(world);
  merged.set(world, created);
  return created;
};

/** The area a portal of `world` leads into, or null for an unknown portal. */
const targetAreaOf = (world: AreaWorld, portalId: string): string | null => {
  for (const area of world.areas) {
    const portal = area.graph.portals?.find(({ id }) => id === portalId);
    if (portal !== undefined) {
      return world.areaOf.get(portal.to) ?? area.id;
    }
  }
  return null;
};

/** A choice portal's candidates in `world`, or none for any other portal. */
const candidatesOf = (
  world: AreaWorld,
  portalId: string
): readonly string[] => {
  for (const area of world.areas) {
    const portal = area.graph.portals?.find(({ id }) => id === portalId);
    if (portal !== undefined) {
      return portal.kind === "choice" ? (portal.candidates ?? []) : [];
    }
  }
  return [];
};

/**
 * Every unit a portal of `world` may land in: its far side, then a
 * choice's candidates; none for an unknown portal.
 */
const portalUnits = (world: AreaWorld, portalId: string): readonly string[] => {
  for (const area of world.areas) {
    const portal = area.graph.portals?.find(({ id }) => id === portalId);
    if (portal !== undefined) {
      return [portal.to, ...(portal.candidates ?? [])];
    }
  }
  return [];
};

/**
 * Generates the first area still pending and reports true, or false when
 * none is: called until false, it generates them in `ensureAll`'s order. A
 * failure leaves the pending list too, so the calls always end.
 */
const ensureNext = (store: AreaStore): boolean => {
  const next = store.snapshot().world.pending[0];
  if (next === undefined) {
    return false;
  }
  store.ensure(next);
  return true;
};

/** The HUD's warnings: what the generated areas left out, then the areas that failed. */
const warningsOf = (
  world: AreaWorld,
  errors: ReadonlyMap<string, string>
): readonly string[] => [
  ...world.areas.flatMap(({ layout }) =>
    layout.unresolved.map(
      ({ from, to }) => `${from} -> ${to} could not be laid out`
    )
  ),
  ...world.areas.flatMap(({ layout }) =>
    layout.unplacedPortals.map(({ id }) => `${id} has no wall space`)
  ),
  ...[...errors].map(
    ([area, error]) => `${area} could not be generated: ${error}`
  ),
];

/** Every area generated so far, unloaded since or not. */
const generatedIds = (world: AreaWorld): readonly string[] => [
  ...world.areas.map(({ id }) => id),
  ...world.unloaded.map(({ id }) => id),
];

/**
 * The modules generated so far, unloaded since or not: every area of a
 * code world but its entrance and its zones' hubs; a random or preset
 * world's one area.
 */
const builtModules = (world: AreaWorld, code: boolean): number =>
  code
    ? generatedIds(world).filter((id) => id !== world.entry && !isZoneHub(id))
        .length
    : generatedIds(world).length;

/**
 * The zone the room is in (any of its rooms or corridors, or its hub's)
 * with its module areas generated so far and in all; null outside every
 * zone, in the entrance, and before the player is in a room.
 */
const zoneProgress = (
  world: AreaWorld,
  roomId: string | null
): ZoneProgress | null => {
  const areaId = areaOfRoom(world, roomId);
  if (areaId === undefined) {
    return null;
  }
  const zone = world.zones.find((candidate) =>
    candidate.areas.some((id) => id === areaId)
  );
  if (zone === undefined) {
    return null;
  }
  // Its hub comes first and is not a module.
  const modules = zone.areas.slice(1);
  const built = new Set(generatedIds(world));
  return {
    name: zone.name,
    built: modules.filter((id) => built.has(id)).length,
    total: modules.length,
  };
};

/** No area failed: one map for every render without a store. */
const NO_ERRORS: ReadonlyMap<string, string> = new Map();

/** Subscribes to a world that never changes: there is nothing to report. */
const NO_UPDATES = () => () => {
  // Nothing was subscribed, so nothing to undo.
};

const useAreaWorld = (seed: number, options: WorldOptions): AreaView => {
  const source = useMemo(() => storeFor(seed, options), [seed, options]);
  const { store } = source;
  const subscribe = useMemo(
    () => (store === null ? NO_UPDATES : store.subscribe),
    [store]
  );
  const state: AreaState | null = useSyncExternalStore(
    subscribe,
    useCallback(() => store?.snapshot() ?? null, [store])
  );
  const world = state?.world ?? null;
  const warnings = useMemo(
    () => (state === null ? [] : warningsOf(state.world, state.errors)),
    [state]
  );
  const rooms =
    world?.areas.reduce((sum, area) => sum + area.graph.rooms.length, 0) ?? 0;
  const current = useCallback(
    () => (store === null ? null : mergedOf(store.snapshot().world)),
    [store]
  );
  const ensurePortal = useCallback(
    (portalId: string) => {
      const now = store?.snapshot();
      if (store === null || now === undefined) {
        return;
      }
      // A no-op for a built or failed area: pending and unloaded ones generate.
      const area = targetAreaOf(now.world, portalId);
      if (area !== null) {
        store.ensure(area);
      }
    },
    [store]
  );
  const ensureUnit = useCallback(
    (unitId: string) => {
      const now = store?.snapshot();
      if (store === null || now === undefined) {
        return false;
      }
      const area = now.world.areaOf.get(unitId);
      if (area === undefined) {
        return false;
      }
      return "area" in store.ensure(area);
    },
    [store]
  );
  // One per store: its visits start over with the world.
  const unloader = useMemo(
    () => (store === null || options.eager ? null : createUnloader(store)),
    [store, options.eager]
  );
  const unload = useCallback(
    ({ portalId, units, ...pins }: AreaPins) => {
      if (store === null || unloader === null) {
        return;
      }
      const ahead =
        portalId === null ? [] : portalUnits(store.snapshot().world, portalId);
      unloader({ ...pins, units: [...units, ...ahead] });
    },
    [store, unloader]
  );
  const candidates = useCallback(
    (portalId: string) =>
      store === null ? [] : candidatesOf(store.snapshot().world, portalId),
    [store]
  );
  const next = useCallback(
    () => (store === null ? false : ensureNext(store)),
    [store]
  );
  const failedArea = useCallback(
    (portalId: string) => {
      if (state === null) {
        return null;
      }
      const area = targetAreaOf(state.world, portalId);
      return area !== null && state.errors.has(area) ? area : null;
    },
    [state]
  );
  const failedUnit = useCallback(
    (unitId: string) => {
      const area = state?.world.areaOf.get(unitId);
      return area !== undefined && state?.errors.has(area) === true;
    },
    [state]
  );
  const total = options.codeGraph?.modules.length ?? 1;
  const built =
    state === null ? 0 : builtModules(state.world, options.codeGraph !== null);
  return {
    world,
    current,
    rooms,
    ensurePortal,
    ensureUnit,
    candidatesOf: candidates,
    unload,
    ensureNext: next,
    failedArea,
    failedUnit,
    modules: { built, total },
    lastMs: options.eager ? null : (state?.lastMs ?? null),
    warnings,
    errors: state?.errors ?? NO_ERRORS,
    error: source.error,
  };
};

export {
  builtModules,
  candidatesOf,
  ensureNext,
  portalUnits,
  storeFor,
  targetAreaOf,
  useAreaWorld,
  warningsOf,
  zoneProgress,
};
export type { WorldOptions, ZoneProgress };
