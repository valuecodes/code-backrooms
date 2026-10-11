import type { AreaWorld, Point, Rect, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { checkAreas } from "./area-checks";
import { createAreaStore } from "./area-store";
import type { AreaSpec } from "./area-store";
import {
  AREA_GAP,
  assembleAreas,
  packSlots,
  SHELF_WIDTH,
  stripRange,
} from "./areas";
import type { Slot, ZoneSpec } from "./areas";
import { rectGap } from "./fit";
import { areaGraphs } from "./portal-world";
import { createRng, nextInt } from "./random";
import { generateWorld } from "./world-generator";

const moved = (rect: Rect, { x, z }: Point): Rect => ({
  minX: rect.minX + x,
  maxX: rect.maxX + x,
  minZ: rect.minZ + z,
  maxZ: rect.maxZ + z,
});

/** Random off-grid rects in strips 0-3, about one in eight wider than a shelf. */
const randomSlots = (seed: number, count: number): Slot[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, index) => {
    const width =
      nextInt(rng, 1, 8) === 1
        ? nextInt(rng, SHELF_WIDTH + 1, 700)
        : nextInt(rng, 16, 640) / 4;
    const depth = nextInt(rng, 16, 400) / 4;
    const minX = -nextInt(rng, 0, Math.floor(width));
    const minZ = -nextInt(rng, 0, Math.floor(depth));
    return {
      rect: { minX, maxX: minX + width, minZ, maxZ: minZ + depth },
      strip: index === 0 ? 0 : nextInt(rng, 0, 3),
    };
  });
};

const wide = (rect: Rect) => rect.maxX - rect.minX > SHELF_WIDTH;

describe("packSlots", () => {
  const sequences = [
    ...[1, 2, 3, 4, 5, 6].map((seed) => randomSlots(seed, 40)),
    // A wide entry raises the floor before anything else is placed.
    [
      { rect: { minX: -300, maxX: 300, minZ: -5, maxZ: 5 }, strip: 0 },
      ...randomSlots(7, 30).slice(1),
    ],
  ];

  it("is prefix-stable: an area never moves when more are added", () => {
    for (const slots of sequences) {
      const offsets = packSlots(slots);
      for (let n = 0; n <= slots.length; n += 1) {
        expect(packSlots(slots.slice(0, n))).toEqual(offsets.slice(0, n));
      }
    }
  });

  it("keeps every pair AREA_GAP apart, each area in its strip", () => {
    for (const [index, slots] of sequences.entries()) {
      const offsets = packSlots(slots);
      const left = slots[0]?.rect.minX ?? 0;
      const placed = slots.map(({ rect }, at) =>
        moved(rect, offsets[at] ?? { x: 0, z: 0 })
      );
      expect(placed.some((rect, at) => at > 0 && wide(rect))).toBe(true);
      for (const [i, a] of placed.entries()) {
        for (const [j, b] of placed.slice(i + 1).entries()) {
          expect(
            rectGap(a, b),
            `sequence ${index}: ${i} and ${i + 1 + j}`
          ).toBeGreaterThanOrEqual(AREA_GAP - 1e-9);
        }
      }
      const outside = placed.flatMap((a, i) => {
        const strip = stripRange(left, slots[i]?.strip ?? 0);
        return !wide(a) &&
          (a.minX < strip.minX - 1e-9 || a.maxX > strip.maxX + 1e-9)
          ? [i]
          : [];
      });
      expect(outside, `sequence ${index}`).toEqual([]);
      const risen = placed.flatMap((a, i) =>
        i > 0 &&
        wide(a) &&
        a.minZ <
          Math.max(...placed.slice(0, i).map((r) => r.maxZ)) + AREA_GAP - 1e-9
          ? [i]
          : []
      );
      expect(risen, `sequence ${index}`).toEqual([]);
    }
  });

  it("packs each strip from its own left edge, rows starting level", () => {
    const square = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    const offsets = packSlots([
      { rect: square, strip: 0 },
      { rect: square, strip: 2 },
      { rect: square, strip: 1 },
    ]);
    expect(offsets[1]?.x).toBe(stripRange(-10, 2).minX + 10);
    expect(offsets[2]?.x).toBe(stripRange(-10, 1).minX + 10);
    expect(offsets.map(({ z }) => z + 0)).toEqual([0, 0, 0]);
  });
});

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

/** Every order of ensures a player could cause: only areas a built one leads to. */
const walks = (
  built: readonly string[],
  pending: readonly string[]
): string[][] => {
  if (pending.length === 0) {
    return [[]];
  }
  const leadsTo = (from: string) =>
    (graphs.find(([id]) => id === from)?.[1].external ?? []).map(
      (unit) =>
        graphs.find(([, graph]) =>
          graph.rooms.some((room) => room.id === unit)
        )?.[0]
    );
  return pending
    .filter((id) => built.some((from) => leadsTo(from).includes(id)))
    .flatMap((next) =>
      walks(
        [...built, next],
        pending.filter((id) => id !== next)
      ).map((rest) => [next, ...rest])
    );
};

describe("createAreaStore with zones", () => {
  const storeOf = (seed: number) =>
    createAreaStore({ seed, entry: "one", specs: specsOf(seed), zones });

  it("knows every zone's areas before generating them", () => {
    const { world } = storeOf(1).snapshot();
    expect(world.zones).toEqual([
      { id: "a", name: "Zone A", areas: ["two", "four"], bounds: null },
      { id: "b", name: "Zone B", areas: ["three"], bounds: null },
    ]);
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
});

describe("checkAreas on zones", () => {
  it("names an area outside its strip", () => {
    const world = assembled(1, ["two", "three", "four"]);
    const shifted: AreaWorld = {
      ...world,
      areas: world.areas.map((area) =>
        area.id === "three"
          ? { ...area, bounds: moved(area.bounds, { x: -100, z: 0 }) }
          : area
      ),
    };
    expect(checkAreas(shifted)).toContain("area three is outside its strip");
  });

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
