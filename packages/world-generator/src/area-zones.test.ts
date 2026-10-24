import type { AreaWorld, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { checkAreas } from "./area-checks";
import { createAreaStore } from "./area-store";
import type { AreaSpec } from "./area-store";
import { assembleAreas } from "./areas";
import type { ZoneSpec } from "./areas";
import { areaGraphs } from "./portal-world";
import { generateWorld } from "./world-generator";

/**
 * The portal world's three areas plus a fourth hub the second leads to, and
 * a portal from the entry to the third: zone a holds two (its hub) and
 * four, zone b holds three.
 */
const extras = new Map([
  ["one", { from: "hub", to: "hub3" }],
  ["two", { from: "hub2", to: "hub4" }],
]);

const graphs: readonly (readonly [string, WorldGraph])[] = [
  ...areaGraphs.map(([id, graph]): readonly [string, WorldGraph] => {
    const extra = extras.get(id);
    return extra === undefined
      ? [id, graph]
      : [
          id,
          {
            ...graph,
            portals: [
              ...(graph.portals ?? []),
              {
                id: `module:${extra.from}>${extra.to}`,
                kind: "module",
                ...extra,
              },
            ],
            external: [...(graph.external ?? []), extra.to],
          },
        ];
  }),
  [
    "four",
    {
      rooms: [{ id: "hub4", width: 6, depth: 6, hub: true }],
      connections: [],
      portals: [
        { id: "module:hub4>hub", kind: "module", from: "hub4", to: "hub" },
      ],
      external: ["hub"],
    },
  ],
];

const zones: readonly ZoneSpec[] = [
  { id: "a", name: "Zone A", hub: "two" },
  { id: "b", name: "Zone B", hub: "three" },
];

const zoneOf: Readonly<Record<string, string>> = {
  two: "a",
  four: "a",
  three: "b",
};

/** The area each is reached from: the hubs off the entry, four off two. */
const parentOf: Readonly<Record<string, string>> = {
  two: "one",
  three: "one",
  four: "two",
};

const worldOf = (seed: number, id: string) => {
  const graph = graphs.find(([name]) => name === id)?.[1];
  if (graph === undefined) {
    throw new Error(`no graph ${id}`);
  }
  return generateWorld({ seed, graph, corridorPrefix: `${id}/corridor-` });
};

const specsOf = (seed: number): readonly AreaSpec[] =>
  graphs.map(([id, graph]) => ({
    id,
    units: graph.rooms.map((room) => room.id),
    generate: () => worldOf(seed, id),
    ...(zoneOf[id] === undefined ? {} : { zone: zoneOf[id] }),
    ...(parentOf[id] === undefined ? {} : { parent: parentOf[id] }),
  }));

/** Every area assembled at once, in `order` after the entry. */
const assembled = (
  seed: number,
  order: readonly string[],
  zoning: readonly ZoneSpec[] = zones,
  zoneIds: Readonly<Record<string, string>> = zoneOf
): AreaWorld =>
  assembleAreas(
    seed,
    "one",
    ["one", ...order].map((id) => ({
      id,
      world: worldOf(seed, id),
      ...(zoneIds[id] === undefined ? {} : { zone: zoneIds[id] }),
      ...(parentOf[id] === undefined ? {} : { parent: parentOf[id] }),
    })),
    zoning
  );

describe("assembleAreas with zones", () => {
  it("puts each area in its zone, hub first, bounds round the built ones", () => {
    const world = assembled(1, ["four", "three", "two"]);
    expect(world.areas.map((area) => [area.id, area.zoneId] as const)).toEqual([
      ["one", null],
      ["four", "a"],
      ["three", "b"],
      ["two", "a"],
    ]);
    expect(world.zones.map(({ id, name, areas }) => [id, name, areas])).toEqual(
      [
        ["a", "Zone A", ["two", "four"]],
        ["b", "Zone B", ["three"]],
      ]
    );
    const two = world.areas.find((area) => area.id === "two");
    const four = world.areas.find((area) => area.id === "four");
    expect(world.zones[0]?.bounds).toEqual({
      minX: Math.min(two?.bounds.minX ?? 0, four?.bounds.minX ?? 0),
      maxX: Math.max(two?.bounds.maxX ?? 0, four?.bounds.maxX ?? 0),
      minZ: Math.min(two?.bounds.minZ ?? 0, four?.bounds.minZ ?? 0),
      maxZ: Math.max(two?.bounds.maxZ ?? 0, four?.bounds.maxZ ?? 0),
    });
    expect(checkAreas(world)).toEqual([]);
  });

  it("has no zones and no zone ids without zones", () => {
    const world = assembled(1, ["two", "three", "four"], [], {});
    expect(world.zones).toEqual([]);
    expect(world.areas.every((area) => area.zoneId === null)).toBe(true);
  });

  it("throws for an unknown zone, a hub outside its zone and a zoned entry", () => {
    expect(() =>
      assembled(1, ["two", "three", "four"], zones, { ...zoneOf, two: "x" })
    ).toThrow('Unknown zone "x" of area "two"');
    expect(() =>
      assembled(1, ["two", "three", "four"], zones, { ...zoneOf, two: "b" })
    ).toThrow('Zone "a" hub "two" is not in the zone');
    expect(() =>
      assembled(1, ["two", "three", "four"], zones, { ...zoneOf, one: "a" })
    ).toThrow('Entry area "one" cannot be in a zone');
  });
});

/** The areas whose units area `from` has portals into. */
const leadsTo = (from: string) =>
  (graphs.find(([id]) => id === from)?.[1].external ?? []).map(
    (unit) =>
      graphs.find(([, graph]) =>
        graph.rooms.some((room) => room.id === unit)
      )?.[0]
  );

/** Every order of ensures a player could cause: only areas a built one leads to. */
const walks = (
  built: readonly string[],
  pending: readonly string[]
): string[][] => {
  if (pending.length === 0) {
    return [[]];
  }
  return pending
    .filter((id) => built.some((from) => leadsTo(from).includes(id)))
    .flatMap((next) =>
      walks(
        [...built, next],
        pending.filter((id) => id !== next)
      ).map((rest) => [next, ...rest])
    );
};

const storeOf = (seed: number) =>
  createAreaStore({ seed, entry: "one", specs: specsOf(seed), zones });

/** The specs with area `id` parented to `parent`. */
const withParent = (id: string, parent: string) =>
  specsOf(1).map((spec) => (spec.id === id ? { ...spec, parent } : spec));

describe("createAreaStore with zones", () => {
  it("knows every zone's areas before generating them", () => {
    const { world } = storeOf(1).snapshot();
    expect(world.zones).toEqual([
      { id: "a", name: "Zone A", areas: ["two", "four"], bounds: null },
      { id: "b", name: "Zone B", areas: ["three"], bounds: null },
    ]);
    expect(checkAreas(world)).toEqual([]);
  });

  it("keeps a zone's bounds and areas after its areas are evicted", () => {
    const store = storeOf(1);
    for (const id of ["two", "four", "three"]) {
      store.ensure(id);
    }
    const before = store.snapshot().world.zones;
    store.evict("two");
    store.evict("four");
    const { world } = store.snapshot();
    expect(world.zones).toEqual(before);
    expect(world.unloaded.map(({ zoneId }) => zoneId)).toEqual(["a", "a"]);
    expect(checkAreas(world)).toEqual([]);
  });

  it("places areas as the zoned eager assembly does in the same order", () => {
    const store = storeOf(2);
    for (const id of ["three", "two", "four"]) {
      store.ensure(id);
    }
    const eager = assembled(2, ["three", "two", "four"]);
    expect(store.snapshot().world.areas).toEqual(eager.areas);
    expect(store.snapshot().world.zones).toEqual(eager.zones);
  });

  it("passes checkAreas after every ensure, in every order a walk allows", () => {
    const orders = walks(["one"], ["two", "three", "four"]);
    expect(orders.length).toBeGreaterThan(2);
    for (const seed of [1, 2, 3]) {
      for (const order of orders) {
        const store = storeOf(seed);
        for (const id of order) {
          store.ensure(id);
          expect(
            checkAreas(store.snapshot().world),
            `seed ${seed} ${order.join(",")} at ${id}`
          ).toEqual([]);
        }
      }
    }
  });

  it("throws at creation for an unknown zone", () => {
    expect(() =>
      createAreaStore({
        seed: 1,
        entry: "one",
        specs: specsOf(1),
        zones: zones.slice(0, 1),
      })
    ).toThrow('Unknown zone "b" of area "three"');
  });

  it("throws at creation for an unknown parent and a parented entry", () => {
    expect(() =>
      createAreaStore({
        seed: 1,
        entry: "one",
        specs: withParent("four", "nowhere"),
        zones,
      })
    ).toThrow('Unknown parent "nowhere" of area "four"');
    expect(() =>
      createAreaStore({
        seed: 1,
        entry: "one",
        specs: withParent("one", "two"),
        zones,
      })
    ).toThrow('Entry area "one" cannot have a parent');
  });
});

describe("checkAreas on zones", () => {
  it("names a zone hub the entry does not lead to", () => {
    const world = assembled(
      1,
      ["two", "three", "four"],
      [...zones, { id: "c", name: "Zone C", hub: "four" }],
      { ...zoneOf, four: "c" }
    );
    expect(checkAreas(world)).toEqual([
      "zone c hub four is not reached from the entry",
    ]);
  });

  it("counts only placed portals of the entry, also into a pending hub", () => {
    const { world } = createAreaStore({
      seed: 1,
      entry: "one",
      specs: specsOf(1),
      zones,
    }).snapshot();
    expect(checkAreas(world)).toEqual([]);
    // The graph still has the portal; the layout left it unplaced.
    const unplaced: AreaWorld = {
      ...world,
      areas: world.areas.map((area) => ({
        ...area,
        built: {
          ...area.built,
          portals: area.built.portals.filter(
            ({ portal }) => portal.id !== "module:hub>hub3"
          ),
        },
      })),
    };
    expect(checkAreas(unplaced)).toContain(
      "zone b hub three is not reached from the entry"
    );
  });

  it("names an area its hub cannot reach once the zone is built, not before", () => {
    const hubThree: readonly ZoneSpec[] = [
      { id: "a", name: "Zone A", hub: "two" },
      { id: "b", name: "Zone B", hub: "three" },
    ];
    const zoneIds = { two: "a", three: "b", four: "b" };
    expect(
      checkAreas(assembled(1, ["two", "three", "four"], hubThree, zoneIds))
    ).toEqual(["area four of zone b is unreachable from its hub three"]);
    const store = createAreaStore({
      seed: 1,
      entry: "one",
      specs: specsOf(1).map((spec) => ({
        ...spec,
        ...(spec.id === "four" ? { zone: "b" } : {}),
      })),
      zones: hubThree,
    });
    store.ensure("three");
    expect(checkAreas(store.snapshot().world)).toEqual([]);
  });

  it("names an area whose zoneId is not its zone's", () => {
    const world = assembled(1, ["two", "three", "four"]);
    const wrong: AreaWorld = {
      ...world,
      areas: world.areas.map((area) =>
        area.id === "three" ? { ...area, zoneId: null } : area
      ),
    };
    expect(checkAreas(wrong)).toEqual([
      "area three has zoneId null, expected b",
    ]);
  });
});
