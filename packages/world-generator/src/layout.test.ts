import type { WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { generateGraph } from "./graph";
import { generateLayout } from "./layout";
import { checkLayout } from "./layout-checks";
import { presets } from "./presets";

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

describe("presets", () => {
  it.each(Object.entries(presets))("%s lays out every room", (_, graph) => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const layout = generateLayout(graph, seed);
      expect(checkLayout(graph, layout)).toEqual([]);
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
