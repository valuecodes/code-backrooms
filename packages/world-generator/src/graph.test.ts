import type { WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { GRID, ROOM_SIZE_CLASSES } from "./config";
import { generateGraph, validateGraph } from "./graph";

const connected = (graph: WorldGraph): boolean => {
  try {
    validateGraph(graph);
    return true;
  } catch {
    return false;
  }
};

describe("generateGraph", () => {
  it("creates the requested number of rooms with unique ids", () => {
    const graph = generateGraph({ seed: 1, roomCount: 15 });
    expect(graph.rooms).toHaveLength(15);
    expect(new Set(graph.rooms.map((room) => room.id)).size).toBe(15);
  });

  it("is deterministic per seed and different across seeds", () => {
    expect(generateGraph({ seed: 7, roomCount: 12 })).toEqual(
      generateGraph({ seed: 7, roomCount: 12 })
    );
    expect(generateGraph({ seed: 7, roomCount: 12 })).not.toEqual(
      generateGraph({ seed: 8, roomCount: 12 })
    );
  });

  it("is always connected and valid", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      expect(
        connected(generateGraph({ seed, roomCount: 10 + (seed % 11) }))
      ).toBe(true);
    }
  });

  it("adds a few extra connections beyond the spanning tree", () => {
    const graph = generateGraph({ seed: 3, roomCount: 20 });
    expect(graph.connections.length).toBeGreaterThan(19);
  });

  it("mixes size classes and makes rectangular rooms on the grid", () => {
    const sizes = new Set<string>();
    let rectangular = 0;
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const room of generateGraph({ seed, roomCount: 15 }).rooms) {
        expect(room.size).toBeDefined();
        if (room.size === undefined) {
          continue;
        }
        sizes.add(room.size);
        const { min, max } = ROOM_SIZE_CLASSES[room.size];
        for (const value of [room.width, room.depth]) {
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
          expect((value / GRID) % 1).toBe(0);
        }
        if (room.width !== room.depth) {
          rectangular += 1;
        }
      }
    }
    expect([...sizes].sort()).toEqual(["large", "medium", "small"]);
    expect(rectangular).toBeGreaterThan(100);
  });

  it("rejects a non-positive room count", () => {
    expect(() => generateGraph({ seed: 1, roomCount: 0 })).toThrow(/positive/);
  });
});

describe("validateGraph", () => {
  const base: WorldGraph = {
    rooms: [
      { id: "a", width: 6, depth: 6 },
      { id: "b", width: 6, depth: 6 },
    ],
    connections: [{ from: "a", to: "b" }],
  };

  it("accepts a sound graph", () => {
    expect(() => validateGraph(base)).not.toThrow();
  });

  it("rejects an empty graph", () => {
    expect(() => validateGraph({ rooms: [], connections: [] })).toThrow(
      /at least one room/
    );
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      validateGraph({
        ...base,
        rooms: [...base.rooms, { id: "a", width: 6, depth: 6 }],
      })
    ).toThrow(/duplicated/);
  });

  it("rejects dimensions off the grid or too small", () => {
    const b = { id: "b", width: 6, depth: 6 };
    expect(() =>
      validateGraph({ ...base, rooms: [{ id: "a", width: 6.3, depth: 6 }, b] })
    ).toThrow(/multiple of/);
    expect(() =>
      validateGraph({ ...base, rooms: [{ id: "a", width: 1, depth: 6 }, b] })
    ).toThrow(/at least/);
  });

  it("rejects unknown, self and duplicate connections", () => {
    expect(() =>
      validateGraph({ ...base, connections: [{ from: "a", to: "zz" }] })
    ).toThrow(/unknown room/);
    expect(() =>
      validateGraph({ ...base, connections: [{ from: "a", to: "a" }] })
    ).toThrow(/itself/);
    expect(() =>
      validateGraph({
        ...base,
        connections: [...base.connections, { from: "b", to: "a" }],
      })
    ).toThrow(/duplicated/);
  });

  it("does not confuse connections whose ids contain the separator", () => {
    const graph: WorldGraph = {
      rooms: [
        { id: "a", width: 6, depth: 6 },
        { id: "b|c", width: 6, depth: 6 },
        { id: "a|b", width: 6, depth: 6 },
        { id: "c", width: 6, depth: 6 },
      ],
      connections: [
        { from: "a", to: "b|c" },
        { from: "a|b", to: "c" },
        { from: "a", to: "a|b" },
      ],
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("rejects an unknown start and an unreachable room", () => {
    expect(() => validateGraph({ ...base, start: "zz" })).toThrow(/start room/);
    expect(() => validateGraph({ ...base, connections: [] })).toThrow(
      /not reachable/
    );
  });
});
