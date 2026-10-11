// Areas generated when they are first needed: the entry at once, every other
// one on `ensure`, placed in the order they were asked for. An area never
// moves once placed (the packing is a function of the sequence so far), so
// a world that grows keeps every room, portal and landing it had.

import type { AreaWorld, BuiltArea, GeneratedWorld, Rect } from "@repo/types";

import {
  areaZones,
  checkAreaSpecs,
  layoutBounds,
  packOffsets,
  parentsOf,
  placeArea,
} from "./areas";
import type { ZoneSpec } from "./areas";
import { placeNext } from "./tree-packing";
import type { PlacedSlot } from "./tree-packing";

/** An area to generate on demand. */
type AreaSpec = {
  readonly id: string;
  /** Every unit (graph room id) the area will have, known before it exists. */
  readonly units: readonly string[];
  /** Lays the area out round the origin; may throw. */
  readonly generate: () => GeneratedWorld;
  /** The id of its zone; none for an area outside every zone. */
  readonly zone?: string;
  /** The area it is reached from, placed beside it (`placeNext`). */
  readonly parent?: string;
};

type AreaState = {
  /** The areas so far in the order they were generated; `pending` the rest. */
  readonly world: AreaWorld;
  /** The message of every area that could not be generated, by area id. */
  readonly errors: ReadonlyMap<string, string>;
  /** Milliseconds the last generating `ensure` took, or null before one. */
  readonly lastMs: number | null;
};

type Ensured = { readonly area: BuiltArea } | { readonly error: string };

type AreaStore = {
  /** The same object until an `ensure` changes something. */
  readonly snapshot: () => AreaState;
  /** Called once per change; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Generates the area unless it exists; a failure is kept, not retried. */
  readonly ensure: (areaId: string) => Ensured;
  /** Every area, in spec order. */
  readonly ensureAll: () => void;
};

type AreaStoreOptions = {
  readonly seed: number;
  /** The area generated at once, at the origin; its failure throws. */
  readonly entry: string;
  readonly specs: readonly AreaSpec[];
  /** Zones the areas are listed in; none by default. */
  readonly zones?: readonly ZoneSpec[];
};

const createAreaStore = ({
  seed,
  entry,
  specs,
  zones = [],
}: AreaStoreOptions): AreaStore => {
  const specOf = new Map(specs.map((spec) => [spec.id, spec]));
  // Replaced, never changed, so an older snapshot keeps its own.
  let areaOf: ReadonlyMap<string, string> = new Map(
    specs.flatMap((spec) => spec.units.map((unit) => [unit, spec.id] as const))
  );
  checkAreaSpecs(zones, entry, specs);
  const parents = parentsOf(specs);
  const listeners = new Set<() => void>();
  const built = new Map<string, BuiltArea>();
  /** Every placed area, where it is; and its bounds round the origin. */
  const placed: PlacedSlot[] = [];
  const unmoved: Rect[] = [];
  const areas: BuiltArea[] = [];
  const errors = new Map<string, string>();

  /** Beside its parent with parents, else in rows as `packOffsets` packs. */
  const slotOf = (id: string, rect: Rect): PlacedSlot =>
    parents.size > 0
      ? placeNext(placed, { id, rect }, parents)
      : {
          id,
          rect,
          anchor: null,
          offset: packOffsets([...unmoved, rect]).at(-1) ?? { x: 0, z: 0 },
        };

  const generate = (spec: AreaSpec): BuiltArea => {
    const world = spec.generate();
    const rect = layoutBounds(world.layout.rooms);
    const slot = slotOf(spec.id, rect);
    const area = placeArea(
      { id: spec.id, world, zone: spec.zone },
      slot.offset
    );
    // Only a placed area takes up room: a throw above leaves no trace.
    placed.push({ ...slot, rect: area.bounds });
    unmoved.push(rect);
    built.set(spec.id, area);
    areas.push(area);
    // Rooms its units did not list (more hubs than planned) belong to it too.
    const unowned = area.graph.rooms.filter((room) => !areaOf.has(room.id));
    if (unowned.length > 0) {
      areaOf = new Map([
        ...areaOf,
        ...unowned.map((room) => [room.id, spec.id] as const),
      ]);
    }
    return area;
  };

  const stateOf = (lastMs: number | null): AreaState => ({
    world: {
      seed,
      entry,
      areas: [...areas],
      pending: specs
        .map((spec) => spec.id)
        .filter((id) => !built.has(id) && !errors.has(id)),
      failed: [...errors.keys()],
      areaOf,
      zones: areaZones(zones, specs, areas),
    },
    errors: new Map(errors),
    lastMs,
  });

  const first = specOf.get(entry);
  if (first === undefined) {
    throw new Error(`Unknown entry area "${entry}"`);
  }
  generate(first);
  let state = stateOf(null);

  const publish = (started: number) => {
    state = stateOf(Date.now() - started);
    for (const listener of listeners) {
      listener();
    }
  };

  const ensure = (areaId: string): Ensured => {
    const existing = built.get(areaId);
    if (existing !== undefined) {
      return { area: existing };
    }
    const failed = errors.get(areaId);
    if (failed !== undefined) {
      return { error: failed };
    }
    const spec = specOf.get(areaId);
    if (spec === undefined) {
      return { error: `Unknown area "${areaId}"` };
    }
    // Whole milliseconds are enough for the HUD's readout, and Date needs
    // no DOM or Node types.
    const started = Date.now();
    try {
      const area = generate(spec);
      publish(started);
      return { area };
    } catch (error) {
      const message = String(error);
      errors.set(areaId, message);
      publish(started);
      return { error: message };
    }
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure,
    ensureAll: () => {
      for (const spec of specs) {
        ensure(spec.id);
      }
    },
  };
};

export { createAreaStore };
export type { AreaSpec, AreaState, AreaStore, Ensured };
