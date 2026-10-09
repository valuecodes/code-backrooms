import type { Port, Rect, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { candidateBatches } from "./candidates";
import { clusterGraph } from "./cluster-world";
import { fit, NONE } from "./fit";
import { generateGraph } from "./graph";
import { generateLayout } from "./layout";
import { checkLayout } from "./layout-checks";
import { presets } from "./presets";
import { createRng } from "./random";

const corridorLengths = (graph: WorldGraph, seed: number): number[] =>
  generateLayout(graph, seed)
    .rooms.filter((room) => room.kind === "corridor")
    .map((room) => Math.max(room.width, room.depth));

describe("generateLayout", () => {
  it("is deterministic per seed and different across seeds", () => {
    const graph = generateGraph({ seed: 5, roomCount: 15 });
    expect(generateLayout(graph, 5)).toEqual(generateLayout(graph, 5));
    expect(generateLayout(graph, 5)).not.toEqual(generateLayout(graph, 6));
  });

  it(
    "satisfies every invariant over many seeds and sizes",
    { timeout: 60 * 1000 },
    () => {
      let direct = 0;
      const lengths = new Set<number>();
      let unresolved = 0;
      let extras = 0;
      const failures: number[] = [];
      for (let seed = 1; seed <= 200; seed += 1) {
        const graph = generateGraph({ seed, roomCount: 10 + (seed % 11) });
        extras += graph.connections.length - graph.rooms.length + 1;
        let layout;
        try {
          layout = generateLayout(graph, seed);
        } catch {
          failures.push(seed);
          continue;
        }
        expect(checkLayout(graph, layout)).toEqual([]);
        unresolved += layout.unresolved.length;
        const corridors = layout.rooms.filter(
          (room) => room.kind === "corridor"
        );
        direct +=
          graph.connections.length -
          layout.unresolved.length -
          corridors.length;
        for (const corridor of corridors) {
          lengths.add(Math.max(corridor.width, corridor.depth));
        }
      }
      // Both direct doorways and hallways of several lengths occur.
      expect(direct).toBeGreaterThan(0);
      expect(lengths.size).toBeGreaterThanOrEqual(3);
      // Only a crowded random graph (well under 1 %) cannot be packed at all;
      // generateWorld swaps those for the next graph of the seed.
      expect(failures.length).toBeLessThanOrEqual(3);
      // Spanning-tree connections always place; a minority of loop closers cannot.
      expect(unresolved).toBeLessThan(extras / 3);
    }
  );

  it("places large rooms among small ones without overlap", () => {
    const graph: WorldGraph = {
      rooms: [
        { id: "big", width: 20, depth: 14 },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `s${i}`,
          width: 5,
          depth: 5,
        })),
      ],
      connections: Array.from({ length: 6 }, (_, i) => ({
        from: "big",
        to: `s${i}`,
      })),
    };
    const layout = generateLayout(graph, 1);
    expect(checkLayout(graph, layout)).toEqual([]);
    const big = layout.rooms.find((room) => room.id === "big");
    expect(big?.doors).toHaveLength(6);
    expect(layout.unresolved).toEqual([]);
  });

  it("gives the hub several doors, two of them on one wall", () => {
    const layout = generateLayout(presets.hub, 2);
    expect(checkLayout(presets.hub, layout)).toEqual([]);
    expect(layout.unresolved).toEqual([]);
    const hub = layout.rooms.find((room) => room.id === "hub");
    expect(hub?.doors.length).toBe(6);
    const walls = (hub?.doors ?? []).map((door) => door.wall);
    expect(new Set(walls).size).toBeLessThan(walls.length);
  });

  it("varies corridor lengths between seeds", () => {
    const graph = generateGraph({ seed: 11, roomCount: 20 });
    const all = new Set(
      [1, 2, 3, 4, 5].flatMap((seed) => corridorLengths(graph, seed))
    );
    expect(all.size).toBeGreaterThanOrEqual(3);
  });

  it("puts the start room at the origin", () => {
    const layout = generateLayout(presets.branching, 1);
    const entry = layout.rooms.find((room) => room.id === "entry");
    expect(entry?.position).toEqual([0, 0, 0]);
  });

  it("keeps supplied ids that look like generated ones distinct", () => {
    const graph: WorldGraph = {
      rooms: [
        { id: "corridor-1", width: 6, depth: 6 },
        { id: "a|b", width: 6, depth: 6 },
        { id: "c", width: 6, depth: 6 },
      ],
      connections: [
        { from: "corridor-1", to: "a|b" },
        { from: "a|b", to: "c" },
        { from: "c", to: "corridor-1" },
      ],
    };
    for (let seed = 1; seed <= 10; seed += 1) {
      const layout = generateLayout(graph, seed);
      expect(checkLayout(graph, layout)).toEqual([]);
      const ids = layout.rooms.map((room) => room.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining(["corridor-1", "a|b", "c"]));
    }
  });

  it("rejects an invalid graph before placing anything", () => {
    expect(() =>
      generateLayout(
        {
          rooms: [{ id: "a", width: 6, depth: 6 }],
          connections: [],
          start: "b",
        },
        1
      )
    ).toThrow(/start room/);
  });

  it("throws, naming the connection, when a room cannot be placed", () => {
    // A 2 x 2 room cannot host six neighbours: each wall fits one door.
    const graph: WorldGraph = {
      rooms: [
        { id: "tiny", width: 2, depth: 2 },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `n${i}`,
          width: 5,
          depth: 5,
        })),
      ],
      connections: Array.from({ length: 6 }, (_, i) => ({
        from: "tiny",
        to: `n${i}`,
      })),
    };
    expect(() => generateLayout(graph, 1)).toThrow(
      /no placement for tiny -> n/
    );
  });
});

describe("clusters", () => {
  it("places the cluster off the hub in every orientation and its callees off its ports", () => {
    const entryWalls = new Set<string>();
    let direct = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const layout = generateLayout(clusterGraph, seed);
      expect(checkLayout(clusterGraph, layout), `seed ${seed}`).toEqual([]);
      expect(layout.unresolved, `seed ${seed}`).toEqual([]);
      expect(layout.unplacedPortals, `seed ${seed}`).toEqual([]);
      const own = layout.rooms.filter((room) => room.cluster === "fn");
      expect(own.map((room) => room.id)).toEqual(["step", "call", "ret"]);
      const entry = own.find((room) => room.entry !== undefined);
      entryWalls.add(entry?.entry ?? "none");
      const call = own.find((room) => room.id === "call");
      const toCallee = call?.doors.find((door) => {
        const target = layout.rooms.find(
          (room) => room.id === door.targetRoomId
        );
        return (
          door.targetRoomId === "callee" ||
          (target?.connection?.from === "fn" &&
            target.connection.to === "callee")
        );
      });
      expect(toCallee, `seed ${seed}`).toBeDefined();
      direct += toCallee?.targetRoomId === "callee" ? 1 : 0;
      const ret = own.find((room) => room.id === "ret");
      expect(ret?.portals).toHaveLength(1);
      expect(ret?.role).toBe("return");
      expect(call?.label).toBe("callee(…)");
    }
    expect([...entryWalls].sort()).toEqual(["east", "north", "south", "west"]);
    expect(direct).toBeGreaterThan(0);
  });

  it("only reaches a callee through a corridor when the port's surroundings are blocked", () => {
    const anchor: Rect = { minX: 0, maxX: 4, minZ: 0, maxZ: 9 };
    const port: Port = { roomId: "call", wall: "east", lo: 4, hi: 7 };
    const placed = new Map<string, Rect>([
      ["fn", anchor],
      ["above", { minX: 4, maxX: 7, minZ: -20, maxZ: 2 }],
      ["below", { minX: 4, maxX: 7, minZ: 9, maxZ: 30 }],
    ]);
    const next = candidateBatches(createRng(3), anchor, [port], () => ({
      width: 5,
      depth: 5,
    }));
    const fitting = [];
    for (let batch = next(); batch !== null; batch = next()) {
      for (const option of batch) {
        const corridorFits =
          option.corridor === null ||
          fit(option.corridor, placed, new Set(["fn"]), NONE) !== null;
        const roomFits =
          fit(
            option.room,
            placed,
            option.corridor === null ? new Set(["fn"]) : NONE,
            NONE
          ) !== null;
        if (corridorFits && roomFits) {
          fitting.push(option);
        }
      }
    }
    expect(fitting.length).toBeGreaterThan(0);
    for (const option of fitting) {
      expect(option.wall).toBe("east");
      expect(option.corridor).not.toBeNull();
      expect(option.corridor?.minZ).toBeGreaterThanOrEqual(4);
      expect(option.corridor?.maxZ).toBeLessThanOrEqual(7);
      expect((option.corridor?.maxX ?? 0) - 4).toBeGreaterThanOrEqual(6);
    }
  });

  it("starts in a cluster's entry room when the start is a cluster", () => {
    const layout = generateLayout({ ...clusterGraph, start: "fn" }, 1);
    expect(layout.startRoomId).toBe("step");
    const step = layout.rooms.find((room) => room.id === "step");
    expect(step?.position).toEqual([0, 0, -2.5]);
    expect(step?.entry).toBe("north");
    expect(checkLayout({ ...clusterGraph, start: "fn" }, layout)).toEqual([]);
  });

  it("rejects a cluster whose rooms do not fill its box", () => {
    const [hub, fn, ...rest] = clusterGraph.rooms;
    expect(fn?.cluster).toBeDefined();
    const graph: WorldGraph = {
      ...clusterGraph,
      rooms: [
        hub ?? { id: "hub", width: 16, depth: 12 },
        { ...(fn ?? { id: "fn" }), width: 4, depth: 10 },
        ...rest,
      ],
    };
    expect(() => generateLayout(graph, 1)).toThrow(/cluster is 4 x 9/);
  });
});

/** FNV-1a over a layout's rooms: a cheap, stable fingerprint. */
const fingerprint = (graph: WorldGraph, seed: number): string => {
  const text = JSON.stringify(generateLayout(graph, seed).rooms);
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

describe("plain layouts", () => {
  // Captured before clusters existed: ports and units must not change the
  // random sequence or the emitted rooms of a graph without clusters.
  it.each([
    ["lobby", 1, "28bef6f2"],
    ["lobby", 2, "d1acc5cf"],
    ["lobby", 3, "ee9c4803"],
    ["linear", 1, "bfca3ad3"],
    ["linear", 2, "44bebdad"],
    ["linear", 3, "26e21581"],
    ["branching", 1, "1c55e7bc"],
    ["branching", 2, "0827926c"],
    ["branching", 3, "511af15b"],
    ["hub", 1, "fe2afe08"],
    ["hub", 2, "78a1c65a"],
    ["hub", 3, "64379192"],
    ["cycle", 1, "00cab03f"],
    ["cycle", 2, "df414573"],
    ["cycle", 3, "aa75d611"],
  ] as const)("%s seed %i is unchanged", (name, seed, expected) => {
    expect(fingerprint(presets[name], seed)).toBe(expected);
  });

  it.each([
    [1, "b5172719"],
    [2, "5e93bb7b"],
    [3, "49fe4a98"],
    [4, "779a4482"],
    [5, "87921ec8"],
  ])("random seed %i is unchanged", (seed, expected) => {
    expect(fingerprint(generateGraph({ seed, roomCount: 15 }), seed)).toBe(
      expected
    );
  });
});

describe("presets", () => {
  it.each(Object.entries(presets))("%s lays out every room", (_, graph) => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const layout = generateLayout(graph, seed);
      expect(checkLayout(graph, layout)).toEqual([]);
      expect(layout.unplacedPortals).toEqual([]);
      expect(layout.rooms.filter((room) => room.kind === "room")).toHaveLength(
        graph.rooms.length
      );
    }
  });

  it.each(["lobby", "linear", "branching", "hub"] as const)(
    "%s places every connection for every seed",
    (name) => {
      for (let seed = 1; seed <= 20; seed += 1) {
        expect(generateLayout(presets[name], seed).unresolved).toEqual([]);
      }
    }
  );

  it("closes the cycle for most seeds", () => {
    const closed = Array.from({ length: 20 }, (_, i) =>
      generateLayout(presets.cycle, i + 1)
    ).filter((layout) => layout.unresolved.length === 0);
    expect(closed.length).toBeGreaterThan(12);
  });
});
