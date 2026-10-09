import type { RoomCluster, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { cluster, clusterGraph } from "./cluster-world";
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

describe("validateGraph portals", () => {
  const rooms = [
    { id: "a", width: 6, depth: 6 },
    { id: "b", width: 6, depth: 6 },
  ];
  const connections = [{ from: "a", to: "b" }];

  it("accepts portals between known rooms, including back into their own", () => {
    expect(() =>
      validateGraph({
        rooms,
        connections,
        portals: [
          { id: "p", kind: "call", from: "a", to: "b" },
          { id: "self", kind: "call", from: "a", to: "a" },
        ],
      })
    ).not.toThrow();
  });

  it("rejects a portal to an unknown room or with a used id", () => {
    expect(() =>
      validateGraph({
        rooms,
        connections,
        portals: [{ id: "p", kind: "call", from: "a", to: "zzz" }],
      })
    ).toThrow(/unknown room/);
    expect(() =>
      validateGraph({
        rooms,
        connections,
        portals: [
          { id: "p", kind: "call", from: "a", to: "b" },
          { id: "p", kind: "return", from: "b", to: "a" },
        ],
      })
    ).toThrow(/duplicated/);
    expect(() =>
      validateGraph({
        rooms,
        connections,
        portals: [{ id: "a", kind: "call", from: "a", to: "b" }],
      })
    ).toThrow(/already a room id/);
  });
});

/** The cluster graph with `fn`'s cluster replaced. */
const withCluster = (
  patch: Partial<RoomCluster>,
  extra: Partial<WorldGraph> = {}
): WorldGraph => ({
  ...clusterGraph,
  ...extra,
  rooms: clusterGraph.rooms.map((room) =>
    room.id === "fn" ? { ...room, cluster: { ...cluster, ...patch } } : room
  ),
});

/** The fixture's rooms with one of them changed. */
const roomsWith = (
  id: string,
  change: Partial<RoomCluster["rooms"][number]>
): RoomCluster["rooms"] =>
  cluster.rooms.map((room) => (room.id === id ? { ...room, ...change } : room));

describe("validateGraph clusters", () => {
  it("accepts the cluster fixture and a portal on one of its rooms", () => {
    expect(() => validateGraph(clusterGraph)).not.toThrow();
  });

  it("rejects rooms off the grid, overlapping, outside or not filling the box", () => {
    expect(() =>
      validateGraph(
        withCluster({
          rooms: roomsWith("step", {
            rect: { minX: 0, maxX: 4, minZ: 0, maxZ: 4.3 },
          }),
        })
      )
    ).toThrow(/off the grid/);
    expect(() =>
      validateGraph(
        withCluster({
          rooms: roomsWith("step", {
            rect: { minX: 0, maxX: 4, minZ: 0, maxZ: 5 },
          }),
        })
      )
    ).toThrow(/overlap/);
    expect(() =>
      validateGraph(
        withCluster({
          rooms: cluster.rooms.filter((room) => room.id !== "step"),
          doors: cluster.doors.filter((door) => door.from !== "step"),
          ports: cluster.ports.filter((port) => port.roomId !== "step"),
        })
      )
    ).toThrow(/do not fill/);
  });

  it("rejects duplicate ids, including across clusters and graph rooms", () => {
    expect(() =>
      validateGraph(withCluster({ rooms: roomsWith("call", { id: "hub" }) }))
    ).toThrow(/duplicated/);
  });

  it("rejects ports off the boundary, more than one entry port, and an entry port elsewhere", () => {
    expect(() =>
      validateGraph(
        withCluster({
          ports: [
            ...cluster.ports,
            {
              roomId: "step",
              wall: "south",
              lo: 0,
              hi: 4,
              reservedFor: "callee",
            },
          ],
        })
      )
    ).toThrow(/boundary/);
    expect(() =>
      validateGraph(
        withCluster({
          ports: [
            ...cluster.ports,
            { roomId: "ret", wall: "south", lo: 0, hi: 4 },
          ],
        })
      )
    ).toThrow(/entry port/);
    expect(() =>
      validateGraph(withCluster({ ports: cluster.ports.slice(1) }))
    ).toThrow(/exactly one entry port/);
    expect(() =>
      validateGraph(
        withCluster({
          ports: [
            {
              roomId: "call",
              wall: "east",
              lo: 4,
              hi: 7,
              reservedFor: "nobody",
            },
            ...cluster.ports,
          ],
        })
      )
    ).toThrow(/unknown room "nobody"/);
  });

  it("rejects a door without a shared edge and an unreachable room", () => {
    expect(() =>
      validateGraph(withCluster({ doors: [{ from: "step", to: "ret" }] }))
    ).toThrow(/shared edge/);
    expect(() =>
      validateGraph(withCluster({ doors: cluster.doors.slice(0, 1) }))
    ).toThrow(/not reachable from the entry/);
  });

  it("ties a cluster's placed portals to the graph's", () => {
    expect(() => validateGraph(withCluster({}, { portals: [] }))).toThrow(
      /which the graph does not have/
    );
    expect(() =>
      validateGraph(
        withCluster(
          {},
          {
            portals: [
              { id: "return:fn", kind: "return", from: "call", to: "hub" },
            ],
          }
        )
      )
    ).toThrow(/placed on "ret"/);
    expect(() =>
      validateGraph(
        withCluster({
          portals: [
            { id: "return:fn", kind: "return", roomId: "ret", wall: "south" },
          ],
        })
      )
    ).toThrow(/both a wall and a position/);
  });
});

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
