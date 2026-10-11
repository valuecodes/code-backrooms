// Areas generated when they are first needed: the entry at once, every other
// one on `ensure`, placed in the order they were asked for. An area never
// moves once placed (the packing is a function of the sequence so far), so
// a world that grows keeps every room, portal and landing it had.

import type { AreaWorld, BuiltArea, GeneratedWorld, Rect } from "@repo/types";

import { layoutBounds, packOffsets, placeArea } from "./areas";

/** An area to generate on demand. */
type AreaSpec = {
  readonly id: string;
  /** Every unit (graph room id) the area will have, known before it exists. */
  readonly units: readonly string[];
  /** Lays the area out round the origin; may throw. */
  readonly generate: () => GeneratedWorld;
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
};

const createAreaStore = ({
  seed,
  entry,
  specs,
}: AreaStoreOptions): AreaStore => {
  const specOf = new Map(specs.map((spec) => [spec.id, spec]));
  const areaOf = new Map(
    specs.flatMap((spec) => spec.units.map((unit) => [unit, spec.id] as const))
  );
  const listeners = new Set<() => void>();
  const built = new Map<string, BuiltArea>();
  const bounds: Rect[] = [];
  const areas: BuiltArea[] = [];
  const errors = new Map<string, string>();

  const generate = (spec: AreaSpec): BuiltArea => {
    const world = spec.generate();
    const rect = layoutBounds(world.layout.rooms);
    const offset = packOffsets([...bounds, rect]).at(-1) ?? { x: 0, z: 0 };
    const area = placeArea({ id: spec.id, world }, offset);
    // Only a placed area takes up room: a throw above leaves no trace.
    bounds.push(rect);
    built.set(spec.id, area);
    areas.push(area);
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
