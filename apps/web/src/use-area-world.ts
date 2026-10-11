import type { CodeGraph } from "@repo/code-graph";
import { codeAreaStore } from "@repo/code-graph/module-areas";
import type { AreaWorld, GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { createAreaStore } from "@repo/world-generator/area-store";
import type { AreaState, AreaStore } from "@repo/world-generator/area-store";
import { mergeAreas } from "@repo/world-generator/areas";
import { presets } from "@repo/world-generator/presets";
import type { PresetName } from "@repo/world-generator/presets";
import { useCallback, useMemo, useSyncExternalStore } from "react";

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
  /** Generates the area a portal leads into, unless it exists or failed. */
  readonly ensurePortal: (portalId: string) => void;
  /** The area a portal leads into when that area could not be generated. */
  readonly failedArea: (portalId: string) => string | null;
  /** Modules generated so far and in all; areas of other worlds count as one. */
  readonly modules: { readonly built: number; readonly total: number };
  /** Milliseconds the last area generated on the way took; null when eager. */
  readonly lastMs: number | null;
  /** Connections and portals not laid out and areas that failed, one line each. */
  readonly warnings: readonly string[];
  readonly error: string | null;
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
      const area = targetAreaOf(now.world, portalId);
      if (area !== null && now.world.pending.includes(area)) {
        store.ensure(area);
      }
    },
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
  const total = options.codeGraph?.modules.length ?? 1;
  // A code world's entrance is an area but not a module.
  const built =
    state === null
      ? 0
      : state.world.areas.length - (options.codeGraph === null ? 0 : 1);
  return {
    world,
    current,
    rooms,
    ensurePortal,
    failedArea,
    modules: { built, total },
    lastMs: options.eager ? null : (state?.lastMs ?? null),
    warnings,
    error: source.error,
  };
};

export { storeFor, targetAreaOf, useAreaWorld, warningsOf };
export type { WorldOptions };
