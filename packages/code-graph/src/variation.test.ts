import type { GeneratedWorld, WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { checkLayout } from "@repo/world-generator/layout-checks";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { demoGraph, fixtureGraph } from "./fixture";
import { hubDimensions } from "./room-size";
import { columnJitter, hubRatio } from "./variation";
import { generateCodeWorld, toWorldGraph } from "./world-graph";

/** Two modules, a fan-out, a repeated call and recursion. */
const twoModules = (): CodeGraph =>
  fixtureGraph(
    {
      path: "a.ts",
      functions: [
        { name: "main", lines: 6, calls: ["load", "save", "load"] },
        { name: "load", calls: ["parse"] },
        { name: "parse", calls: ["parse"] },
        { name: "save", lines: 1 },
      ],
    },
    {
      path: "b.ts",
      functions: [
        { name: "run", calls: ["step", "step", "stop"] },
        { name: "step", lines: 2 },
        { name: "stop", lines: 1 },
        { name: "idle", lines: 1 },
      ],
    }
  );

/**
 * Crowded enough that a call door fails to place and is demoted to a
 * portal; at seed 10 the varied footprints used to demote other calls than
 * the plain ones (PR #13 review).
 */
const crowded = (): CodeGraph =>
  fixtureGraph({
    path: "x.ts",
    functions: [
      { name: "f0", calls: ["f0", "f6", "f12"] },
      { name: "f1", calls: ["f3", "f7", "f9", "f5", "f12"] },
      { name: "f2", calls: ["f6", "f1"] },
      { name: "f3", calls: ["f3", "f2"] },
      { name: "f4", calls: ["f0", "f5"] },
      { name: "f5", calls: ["f3", "f2", "f0", "f5"] },
      { name: "f6", calls: ["f10", "f3", "f2"] },
      { name: "f7", calls: ["f7", "f9", "f2"] },
      { name: "f8", calls: ["f5", "f10", "f12", "f3"] },
      { name: "f9", calls: ["f1", "f4", "f5", "f3"] },
      { name: "f10", calls: [] },
      { name: "f11", calls: ["f7", "f1", "f3", "f0"] },
      { name: "f12", calls: ["f11", "f3", "f12"] },
    ],
  });

const graphs: readonly (readonly [string, () => CodeGraph])[] = [
  ["demo", demoGraph],
  ["two modules", twoModules],
  ["a crowded module", crowded],
];

/** A world graph with every footprint dropped: what variation may not change. */
const withoutSizes = (world: WorldGraph) => ({
  ...world,
  rooms: world.rooms.map((room) => ({
    id: room.id,
    hub: room.hub,
    clusterRooms: room.cluster?.rooms.map((inner) => inner.id),
    doors: room.cluster?.doors,
  })),
});

/** Every room's footprint by id: what variation may change. */
const sizes = (world: WorldGraph) =>
  new Map(world.rooms.map((room) => [room.id, [room.width, room.depth]]));

/**
 * What is connected, as sorted lines: cluster doors, connections the layout
 * realised and portals it placed. Variation may never change any of it.
 */
const connectivity = (world: GeneratedWorld): readonly string[] => {
  const unresolved = new Set(
    world.layout.unresolved.map(({ from, to }) => `${from}|${to}`)
  );
  const unplaced = new Set(world.layout.unplacedPortals.map(({ id }) => id));
  return [
    ...world.graph.rooms.flatMap((room) =>
      (room.cluster?.doors ?? []).map(
        (door) =>
          `door|${room.id}|${door.from}|${door.to}|${door.lane?.kind ?? ""}|${door.opening ?? ""}`
      )
    ),
    ...world.graph.connections
      .filter(({ from, to }) => !unresolved.has(`${from}|${to}`))
      .map(({ from, to, kind }) => `connection|${from}|${to}|${kind ?? ""}`),
    ...(world.graph.portals ?? [])
      .filter(({ id }) => !unplaced.has(id))
      .map(({ id, kind, from, to }) => `portal|${id}|${kind}|${from}|${to}`),
  ].toSorted();
};

describe("seeded proportions", () => {
  it("picks a column jitter and a hub ratio per id, none without a seed", () => {
    expect(columnJitter(null, "f")).toBe(0);
    expect(hubRatio(null, "m.ts")).toBe(1);
    const jitters = new Set<number>();
    const ratios = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      jitters.add(columnJitter(seed, "f"));
      ratios.add(hubRatio(seed, "m.ts"));
      expect(columnJitter(seed, "f")).toBe(columnJitter(seed, "f"));
    }
    expect([...jitters].toSorted()).toEqual([0, 0.5, 1]);
    expect([...ratios].toSorted()).toEqual([1, 1.25, 1.5]);
  });

  it("starts a hub wider than deep, within the size cap and its perimeter", () => {
    const wide = hubDimensions(2, 1.5);
    expect(wide).toEqual({ width: 12, depth: 8, size: "large" });
    expect(hubDimensions(2, 1.25).width).toBe(10);
    const busy = hubDimensions(6, 1.5);
    expect(2 * (busy.width + busy.depth)).toBeGreaterThanOrEqual(60);
    expect(hubDimensions(40, 1.5)).toEqual(hubDimensions(40));
  });

  it.each(graphs)(
    "keeps %s plain without a seed and only resizes it with one",
    (_, graphOf) => {
      const graph = graphOf();
      const plain = toWorldGraph(graph);
      expect(toWorldGraph(graph, new Set(), null)).toEqual(plain);
      const varied = toWorldGraph(graph, new Set(), 7);
      expect(withoutSizes(varied)).toEqual(withoutSizes(plain));
      // A column widens by its jitter; it may deepen too, as a wider
      // callee needs a longer port on its caller's wall.
      const before = sizes(plain);
      const columns = varied.rooms.filter((room) => room.cluster !== undefined);
      expect(columns.length).toBeGreaterThan(0);
      for (const room of columns) {
        const [width = 0, depth = 0] = before.get(room.id) ?? [];
        expect([0, 0.5, 1]).toContain(room.width - width);
        expect(room.depth).toBeGreaterThanOrEqual(depth);
      }
    }
  );

  it.each(graphs)(
    "reproduces the plain %s world exactly without variation",
    (_, graphOf) => {
      const graph = graphOf();
      for (let seed = 1; seed <= 5; seed += 1) {
        const old = generateWorld({
          seed,
          graph: toWorldGraph(graph),
          variation: false,
        });
        expect(generateCodeWorld(graph, seed, { variation: false })).toEqual(
          old
        );
      }
    }
  );

  it.each(graphs)(
    "connects %s the same with variation on and off",
    (_, graphOf) => {
      const graph = graphOf();
      for (let seed = 1; seed <= 10; seed += 1) {
        const on = generateCodeWorld(graph, seed);
        const off = generateCodeWorld(graph, seed, { variation: false });
        expect(connectivity(on), `seed ${seed}`).toEqual(connectivity(off));
        expect(on.layout.unresolved, `seed ${seed}`).toEqual([]);
        expect(on.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
        expect(checkLayout(on.graph, on.layout), `seed ${seed}`).toEqual([]);
      }
    }
  );
});
