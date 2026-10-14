import type { AreaWorld } from "@repo/types";
import { describe, expect, it } from "vitest";

import { checkAreas } from "./area-checks";
import { createAreaStore } from "./area-store";
import type { AreaSpec } from "./area-store";
import { pendingPortals } from "./areas";
import { areaGraphs } from "./portal-world";
import { generateWorld } from "./world-generator";

// The three test areas: one leads to two, two to three.

const specsOf = (
  seed: number,
  calls?: Map<string, number>
): readonly AreaSpec[] =>
  areaGraphs.map(([id, graph]) => ({
    id,
    units: graph.rooms.map((room) => room.id),
    generate: () => {
      calls?.set(id, (calls.get(id) ?? 0) + 1);
      return generateWorld({ seed, graph, corridorPrefix: `${id}/corridor-` });
    },
  }));

/** In rows (`packOffsets`): no area has a parent. */
const rowsOf = (seed: number, calls?: Map<string, number>) =>
  createAreaStore({ seed, entry: "one", specs: specsOf(seed, calls) });

/** Each beside the one it is reached from (`placeNext`). */
const parentedOf = (seed: number, calls?: Map<string, number>) =>
  createAreaStore({
    seed,
    entry: "one",
    specs: specsOf(seed, calls).map((spec): AreaSpec => {
      const parent = { two: "one", three: "two" }[spec.id];
      return parent === undefined ? spec : { ...spec, parent };
    }),
  });

const areaIn = (world: AreaWorld, id: string) =>
  world.areas.find((area) => area.id === id);

describe("createAreaStore evict", () => {
  for (const [name, make] of [
    ["rows", rowsOf],
    ["parents", parentedOf],
  ] as const) {
    it(`generates an evicted area again the same and in its place (${name})`, () => {
      const calls = new Map<string, number>();
      const store = make(2, calls);
      store.ensure("two");
      const before = areaIn(store.snapshot().world, "two");
      expect(store.evict("two")).toBe(true);
      expect(areaIn(store.snapshot().world, "two")).toBeUndefined();
      expect("area" in store.ensure("two")).toBe(true);
      const after = areaIn(store.snapshot().world, "two");
      expect(after).not.toBe(before);
      expect(after?.offset).toEqual(before?.offset);
      expect(after?.bounds).toEqual(before?.bounds);
      expect(after?.layout.rooms).toEqual(before?.layout.rooms);
      expect(after?.built.colliders).toEqual(before?.built.colliders);
      expect(after?.built.portals).toEqual(before?.built.portals);
      expect(calls.get("two")).toBe(2);
      expect(store.snapshot().world.unloaded).toEqual([]);
      expect(checkAreas(store.snapshot().world)).toEqual([]);
    });

    it(`places later areas the same with or without an eviction (${name})`, () => {
      const plain = make(3);
      plain.ensure("two");
      plain.ensure("three");
      const evicting = make(3);
      evicting.ensure("two");
      evicting.evict("two");
      // Three is placed while two is unloaded: two's place stays taken.
      evicting.ensure("three");
      evicting.ensure("two");
      for (const id of ["two", "three"]) {
        expect(
          areaIn(evicting.snapshot().world, id)?.offset,
          `${name} ${id}`
        ).toEqual(areaIn(plain.snapshot().world, id)?.offset);
      }
      expect(checkAreas(evicting.snapshot().world)).toEqual([]);
    });
  }

  it("lists an evicted area as unloaded, not pending, and passes checkAreas", () => {
    const store = rowsOf(1);
    store.ensure("two");
    const bounds = areaIn(store.snapshot().world, "two")?.bounds;
    store.evict("two");
    const { world } = store.snapshot();
    expect(world.areas.map(({ id }) => id)).toEqual(["one"]);
    expect(world.unloaded).toEqual([{ id: "two", bounds, zoneId: null }]);
    expect(world.pending).toEqual(["three"]);
    expect(world.failed).toEqual([]);
    expect(world.areaOf.get("work")).toBe("two");
    // Area one's portals into two are dark again, until two comes back.
    const [one] = world.areas;
    expect(one && pendingPortals(world, one)).toEqual([
      "module:hub>hub2",
      "portal:main>work",
    ]);
    expect(checkAreas(world)).toEqual([]);
  });

  it("never evicts the entry, an area not built or an unknown one", () => {
    const store = rowsOf(1);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.snapshot();
    expect(store.evict("one")).toBe(false);
    expect(store.evict("two")).toBe(false);
    expect(store.evict("nowhere")).toBe(false);
    expect(store.snapshot()).toBe(before);
    expect(notified).toBe(0);
    store.ensure("two");
    store.evict("two");
    expect(store.evict("two")).toBe(false);
  });

  it("publishes an eviction and keeps the last generation time", () => {
    const store = rowsOf(1);
    store.ensure("two");
    const grown = store.snapshot();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.evict("two");
    expect(notified).toBe(1);
    expect(store.snapshot()).not.toBe(grown);
    expect(store.snapshot().lastMs).toBe(grown.lastMs);
  });

  it("keeps the outline of an area that fails to come back", () => {
    let generated = 0;
    const specs = specsOf(1).map((spec): AreaSpec =>
      spec.id === "two"
        ? {
            ...spec,
            generate: () => {
              generated += 1;
              if (generated > 1) {
                throw new Error("changed");
              }
              return spec.generate();
            },
          }
        : spec
    );
    const store = createAreaStore({ seed: 1, entry: "one", specs });
    store.ensure("two");
    store.evict("two");
    expect(store.ensure("two")).toEqual({ error: "Error: changed" });
    expect(store.ensure("two")).toEqual({ error: "Error: changed" });
    expect(generated).toBe(2);
    const { world, errors } = store.snapshot();
    expect(world.unloaded.map(({ id }) => id)).toEqual(["two"]);
    expect(world.failed).toEqual([]);
    expect(world.pending).not.toContain("two");
    expect(errors.get("two")).toBe("Error: changed");
  });
});
