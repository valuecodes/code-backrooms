import { ENTRANCE_ID } from "@repo/code-graph/ids";
import { checkAreas } from "@repo/world-generator/area-checks";
import type { AreaStore } from "@repo/world-generator/area-store";
import { describe, expect, it } from "vitest";

import {
  areaOfRoom,
  createUnloader,
  evictions,
  pinnedAreas,
} from "./area-budget";
import { examples } from "./examples";
import { storeFor, targetAreaOf } from "./use-area-world";
import { codeGraphOf } from "./world-from-code";

/** The lazy store of the repo example: the entrance and five modules. */
const repoStore = (seed = 1): AreaStore => {
  const { codeGraph, error } = codeGraphOf(examples.repo);
  if (codeGraph === null) {
    throw new Error(`repo: ${error}`);
  }
  const source = storeFor(seed, {
    codeGraph,
    codeError: null,
    eager: false,
    rooms: 15,
    preset: null,
  });
  if (source.store === null) {
    throw new Error(source.error);
  }
  return source.store;
};

const loadedOf = (store: AreaStore) =>
  store.snapshot().world.areas.map(({ id }) => id);

const NO_PINS = { roomId: null, units: [], returnUnit: null } as const;

describe("evictions", () => {
  const seen = new Map([
    ["a", 3],
    ["b", 1],
    ["c", 2],
    ["d", 4],
  ]);
  const loaded = ["a", "b", "c", "d"];

  it("unloads nothing within the budget", () => {
    expect(evictions({ loaded, pinned: new Set(), seen, budget: 4 })).toEqual(
      []
    );
  });

  it("unloads the least recently seen first, down to the budget", () => {
    expect(evictions({ loaded, pinned: new Set(), seen, budget: 2 })).toEqual([
      "b",
      "c",
    ]);
  });

  it("never unloads a pinned area, and pins win over the budget", () => {
    expect(
      evictions({ loaded, pinned: new Set(["b"]), seen, budget: 2 })
    ).toEqual(["c", "a"]);
    expect(
      evictions({ loaded, pinned: new Set(["a", "b", "c"]), seen, budget: 1 })
    ).toEqual(["d"]);
  });
});

describe("pinnedAreas and areaOfRoom", () => {
  it("pins the entry, the area here and the areas of the units given", () => {
    const store = repoStore();
    const [first, second] = store.snapshot().world.pending;
    store.ensure(first ?? "");
    store.ensure(second ?? "");
    const { world } = store.snapshot();
    const unit = [...world.areaOf].find(([, area]) => area === second)?.[0];
    expect([...pinnedAreas(world, first ?? null, [unit ?? ""])]).toEqual([
      ENTRANCE_ID,
      first,
      second,
    ]);
    expect([...pinnedAreas(world, null, [])]).toEqual([ENTRANCE_ID]);
  });

  it("finds a corridor's area by its layout", () => {
    const store = repoStore();
    const { world } = store.snapshot();
    const [entrance] = world.areas;
    expect(areaOfRoom(world, null)).toBeUndefined();
    expect(areaOfRoom(world, "no such room")).toBeUndefined();
    expect(areaOfRoom(world, ENTRANCE_ID)).toBe(ENTRANCE_ID);
    // A room missing from `areaOf` (a corridor) is found by layout.
    const unmapped = { ...world, areaOf: new Map<string, string>() };
    expect(areaOfRoom(unmapped, entrance?.layout.rooms[0]?.id ?? null)).toBe(
      ENTRANCE_ID
    );
  });
});

describe("createUnloader", () => {
  it("keeps a walk through portals within the budget and the world valid", () => {
    for (const seed of [1, 2, 3]) {
      const store = repoStore(seed);
      const unload = createUnloader(store, 2);
      const walked: string[] = [];
      for (;;) {
        // Through a portal of a loaded area into one not generated yet.
        const { world } = store.snapshot();
        const next = world.areas
          .flatMap((area) => area.graph.portals ?? [])
          .map((portal) => targetAreaOf(world, portal.id))
          .find((area) => area !== null && world.pending.includes(area));
        if (next === undefined || next === null) {
          break;
        }
        store.ensure(next);
        unload({ ...NO_PINS, roomId: next });
        walked.push(next);
        expect(loadedOf(store)).toEqual([ENTRANCE_ID, next]);
        expect(checkAreas(store.snapshot().world)).toEqual([]);
      }
      const { world } = store.snapshot();
      expect(walked.length).toBeGreaterThan(1);
      expect(world.unloaded.map(({ id }) => id)).toEqual(walked.slice(0, -1));
    }
  });

  it("unloads the least recently visited and never what was just loaded", () => {
    const store = repoStore();
    const unload = createUnloader(store, 3);
    const [a, b, c] = store.snapshot().world.pending;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("the repo example has fewer than three modules");
    }
    store.ensure(a);
    unload({ ...NO_PINS, roomId: a });
    store.ensure(b);
    unload({ ...NO_PINS, roomId: b });
    // Ahead of the player in b: c is generated before they step in.
    store.ensure(c);
    unload({ ...NO_PINS, roomId: b });
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, b, c]);
  });

  it("keeps the units given and the area last stood in between rooms", () => {
    const store = repoStore();
    const unload = createUnloader(store, 1);
    const [a, b] = store.snapshot().world.pending;
    store.ensure(a ?? "");
    unload({ ...NO_PINS, roomId: a ?? null });
    store.ensure(b ?? "");
    const unit = [...store.snapshot().world.areaOf].find(
      ([, area]) => area === b
    )?.[0];
    // Over the budget of one: the pins win, and only what is pinned stays.
    unload({ ...NO_PINS, units: [unit ?? ""] });
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, a, b]);
    unload(NO_PINS);
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, a]);
  });

  it("generates the area of the return unit again when it was unloaded", () => {
    const store = repoStore();
    const unload = createUnloader(store, 2);
    const [a, b] = store.snapshot().world.pending;
    store.ensure(a ?? "");
    unload({ ...NO_PINS, roomId: a ?? null });
    store.ensure(b ?? "");
    unload({ ...NO_PINS, roomId: b ?? null });
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, b]);
    const caller = [...store.snapshot().world.areaOf].find(
      ([, area]) => area === a
    )?.[0];
    unload({ ...NO_PINS, roomId: b ?? null, returnUnit: caller ?? null });
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, b, a]);
    // Pinned now, so the next call keeps it although it is over the budget.
    unload({ ...NO_PINS, roomId: b ?? null, returnUnit: caller ?? null });
    expect(loadedOf(store)).toEqual([ENTRANCE_ID, b, a]);
  });
});
