import type { Connection, Portal, WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { checkLayout } from "@repo/world-generator/layout-checks";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { demoGraph, fixtureGraph } from "./fixture";
import { parseFlowNodeId } from "./ids";
import { roomSubject } from "./subjects";
import { toWorldGraph } from "./world-graph";

const call = (from: string, to: string): Connection => ({
  from,
  to,
  kind: "call",
});

/** A portal by kind, owning function, target and label; its room varies. */
const shape = (portal: Portal) => [
  portal.kind,
  parseFlowNodeId(portal.from)?.functionId ?? portal.from,
  portal.to,
  portal.label,
];

const returnShape = (fn: string, hub: string) => ["return", fn, hub, "return"];

const nameOf = (graph: CodeGraph, id: string) =>
  graph.functions.find((fn) => fn.id === id)?.name ?? id;

const callShape = (graph: CodeGraph, caller: string, callee: string) => [
  "call",
  caller,
  callee,
  nameOf(graph, callee),
];

/** The call portal id for the n-th site from `caller` to `callee`. */
const callPortalId = (
  graph: CodeGraph,
  caller: string,
  callee: string,
  index = 0
): string => {
  const site = graph.callSites.filter(
    (candidate) =>
      candidate.callerId === caller && candidate.calleeId === callee
  )[index];
  return `portal:${site?.id ?? "?"}`;
};

const clusterOf = (world: WorldGraph, id: string) =>
  world.rooms.find((room) => room.id === id)?.cluster;

/** Lays the graph out for several seeds; nothing may be left unrealised. */
const laysOutCleanly = (graph: CodeGraph) => {
  const world = toWorldGraph(graph);
  expect(() => validateGraph(world)).not.toThrow();
  for (let seed = 1; seed <= 8; seed += 1) {
    const generated = generateWorld({ seed, graph: world });
    expect(generated.layout.unresolved, `seed ${seed}`).toEqual([]);
    expect(generated.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
    expect(checkLayout(world, generated.layout), `seed ${seed}`).toEqual([]);
  }
};

describe("toWorldGraph", () => {
  it("turns the reference demo into a hub, five clusters, call doors and return portals", () => {
    const graph = demoGraph();
    const world = toWorldGraph(graph);
    expect(world.rooms.map((room) => [room.id, room.label])).toEqual([
      ["demo.ts", "demo.ts"],
      ["demo.ts::main", "main"],
      ["demo.ts::getUser", "getUser"],
      ["demo.ts::showDashboard", "showDashboard"],
      ["demo.ts::showLogin", "showLogin"],
      ["demo.ts::loadSession", "loadSession"],
    ]);
    expect(world.rooms.filter((room) => room.hub === true)).toHaveLength(1);
    const main = clusterOf(world, "demo.ts::main");
    expect(main?.rooms.map((room) => room.role)).toEqual([
      "step",
      "call",
      "call",
      "call",
    ]);
    expect(main?.entryRoomId).toBe(main?.rooms[0]?.id);
    // Each room's lone callee is offered both side walls.
    expect(main?.ports.map((port) => port.reservedFor)).toEqual([
      undefined,
      "demo.ts::getUser",
      "demo.ts::getUser",
      "demo.ts::showDashboard",
      "demo.ts::showDashboard",
      "demo.ts::showLogin",
      "demo.ts::showLogin",
    ]);
    expect(world.rooms[1]).toMatchObject({ width: 4, depth: 21 });
    expect(world.connections).toEqual([
      { from: "demo.ts", to: "demo.ts::main" },
      call("demo.ts::main", "demo.ts::getUser"),
      call("demo.ts::main", "demo.ts::showDashboard"),
      call("demo.ts::main", "demo.ts::showLogin"),
      call("demo.ts::getUser", "demo.ts::loadSession"),
    ]);
    expect(world.portals?.map(shape)).toEqual(
      [
        "demo.ts::main",
        "demo.ts::getUser",
        "demo.ts::showDashboard",
        "demo.ts::showLogin",
        "demo.ts::loadSession",
      ].map((fn) => returnShape(fn, "demo.ts"))
    );
    expect(world.portals?.[0]?.from).toBe(main?.rooms.at(-1)?.id);
    expect(world.start).toBe("demo.ts");
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("lays out as a world the generator accepts", () => {
    const world = toWorldGraph(demoGraph());
    const generated = generateWorld({ seed: 1, graph: world });
    expect(
      generated.layout.rooms.filter((room) => room.kind === "room")
    ).toHaveLength(10);
    expect(generated.layout.unresolved).toEqual([]);
    expect(generated.layout.unplacedPortals).toEqual([]);
    expect(generated.layout.startRoomId).toBe("demo.ts");
    expect(generated.built.portals).toHaveLength(5);
    expect(checkLayout(world, generated.layout)).toEqual([]);
  });

  it("makes repeated calls one door and the rest portals, the reverse call included", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "a", calls: ["b", "b"] },
        { name: "b", calls: ["a"] },
      ],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([
      { from: "m.ts", to: "m.ts::a" },
      call("m.ts::a", "m.ts::b"),
    ]);
    expect(world.portals?.map(shape)).toEqual([
      callShape(graph, "m.ts::a", "m.ts::b"),
      callShape(graph, "m.ts::b", "m.ts::a"),
      returnShape("m.ts::a", "m.ts"),
      returnShape("m.ts::b", "m.ts"),
    ]);
    // The second room of `a` calling b keeps its portal; the first got the door.
    expect(world.portals?.[0]?.id).toBe(
      callPortalId(graph, "m.ts::a", "m.ts::b", 1)
    );
    // The entry port and the first call room's pair; the second room's are portals.
    expect(clusterOf(world, "m.ts::a")?.ports).toHaveLength(3);
    laysOutCleanly(graph);
  });

  it("turns recursion into a portal back into the same unit", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "a", calls: ["a"] }],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([{ from: "m.ts", to: "m.ts::a" }]);
    expect(world.portals?.[0]).toMatchObject({
      id: callPortalId(graph, "m.ts::a", "m.ts::a"),
      kind: "call",
      to: "m.ts::a",
    });
    laysOutCleanly(graph);
  });

  it("attaches the first function of a rootless component", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "lonely" },
        { name: "a", calls: ["b"] },
        { name: "b", calls: ["a"] },
      ],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([
      { from: "m.ts", to: "m.ts::lonely" },
      { from: "m.ts", to: "m.ts::a" },
      call("m.ts::a", "m.ts::b"),
    ]);
    expect(world.portals?.slice(0, 1).map(shape)).toEqual([
      callShape(graph, "m.ts::b", "m.ts::a"),
    ]);
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("attaches functions a directed walk from the roots misses", () => {
    // Only d is a root; a and b call each other and a calls c too.
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "a", calls: ["b", "c"] },
        { name: "b", calls: ["a"] },
        { name: "c" },
        { name: "d", calls: ["c"] },
      ],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([
      { from: "m.ts", to: "m.ts::a" },
      { from: "m.ts", to: "m.ts::d" },
      call("m.ts::d", "m.ts::c"),
      call("m.ts::a", "m.ts::b"),
    ]);
    expect(world.portals?.slice(0, 2).map(shape)).toEqual([
      callShape(graph, "m.ts::a", "m.ts::c"),
      callShape(graph, "m.ts::b", "m.ts::a"),
    ]);
    // A tree: one connection fewer than units, so the layout never fails.
    expect(world.connections).toHaveLength(world.rooms.length - 1);
    laysOutCleanly(graph);
  });

  it("gives the door to the first caller in source order", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "main", calls: ["shared"] },
        { name: "other", calls: ["shared"] },
        { name: "shared" },
      ],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toContainEqual(
      call("m.ts::main", "m.ts::shared")
    );
    expect(world.portals?.[0]?.id).toBe(
      callPortalId(graph, "m.ts::other", "m.ts::shared")
    );
  });

  it("gives every callee of a room a port and lays out a wide fan-out", () => {
    const callees = Array.from({ length: 8 }, (_, index) => ({
      name: `g${index + 1}`,
      lines: 1,
    }));
    const names = callees.map((fn) => fn.name);
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "caller", calls: names },
        { name: "f", calls: names.slice(0, 7) },
        ...callees,
      ],
    });
    const world = toWorldGraph(graph);
    const doorsOut = world.connections.filter(
      (connection) => connection.from === "m.ts::caller"
    );
    expect(doorsOut.map((connection) => connection.to)).toEqual(
      names.map((name) => `m.ts::${name}`)
    );
    expect(
      world.connections.filter((connection) => connection.from === "m.ts::f")
    ).toEqual([]);
    const fromF = (world.portals ?? []).filter(
      (portal) =>
        portal.kind === "call" &&
        parseFlowNodeId(portal.from)?.functionId === "m.ts::f"
    );
    expect(fromF.map((portal) => portal.to)).toEqual(
      names.slice(0, 7).map((name) => `m.ts::${name}`)
    );
    // A lone callee is offered both walls; both ports stay for a tree callee.
    const caller = clusterOf(world, "m.ts::caller");
    expect(caller?.ports.slice(1).map((port) => port.wall)).toEqual(
      Array.from({ length: 8 }, () => ["east", "west"]).flat()
    );
    laysOutCleanly(graph);
  });

  it("lays out a long chain of single-call functions", () => {
    const functions = Array.from({ length: 8 }, (_, index) => ({
      name: `f${index}`,
      calls: index < 7 ? [`f${index + 1}`] : [],
    }));
    const graph = fixtureGraph({ path: "m.ts", functions });
    const world = toWorldGraph(graph);
    expect(world.connections).toHaveLength(8);
    laysOutCleanly(graph);
  });

  it("chains the hubs of several modules and starts at the first", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [{ name: "one" }] },
      { path: "b.ts", functions: [{ name: "two" }] },
      { path: "c.ts", functions: [] }
    );
    const world = toWorldGraph(graph);
    expect(world.start).toBe("a.ts");
    expect(world.connections).toEqual([
      { from: "a.ts", to: "a.ts::one" },
      { from: "a.ts", to: "b.ts" },
      { from: "b.ts", to: "b.ts::two" },
      { from: "b.ts", to: "c.ts" },
    ]);
    expect(world.portals?.map(shape)).toEqual([
      returnShape("a.ts::one", "a.ts"),
      returnShape("b.ts::two", "b.ts"),
    ]);
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("chains extra hubs when a module has many roots", () => {
    const functions = Array.from({ length: 40 }, (_, index) => ({
      name: `f${index}`,
      lines: 1,
    }));
    const graph = fixtureGraph({ path: "m.ts", functions });
    const world = toWorldGraph(graph);
    const hubs = world.rooms.filter((room) => room.label === "m.ts");
    expect(hubs.map((hub) => hub.id)).toEqual(
      Array.from({ length: 13 }, (_, index) =>
        index === 0 ? "m.ts" : `m.ts#${index + 1}`
      )
    );
    expect(hubs.every((hub) => hub.hub === true)).toBe(true);
    expect(world.connections).toEqual(
      expect.arrayContaining([
        { from: "m.ts", to: "m.ts#2" },
        { from: "m.ts#12", to: "m.ts#13" },
        { from: "m.ts", to: "m.ts::f0" },
        { from: "m.ts#13", to: "m.ts::f39" },
      ])
    );
    for (const hub of hubs) {
      const doors = world.connections.filter(
        ({ from, to }) => from === hub.id || to === hub.id
      );
      expect(doors.length).toBeLessThanOrEqual(5);
    }
    // Every function returns to the module's first hub, whichever hub it hangs off.
    expect(world.portals?.map(shape)).toEqual(
      functions.map((fn) => returnShape(`m.ts::${fn.name}`, "m.ts"))
    );
    laysOutCleanly(graph);
    expect(roomSubject(graph, "m.ts#3")).toMatchObject({
      kind: "module",
      module: { path: "m.ts" },
    });
  });

  it("gives an empty module a hub only", () => {
    const world = toWorldGraph(fixtureGraph({ path: "e.ts", functions: [] }));
    expect(world.rooms.map((room) => room.id)).toEqual(["e.ts"]);
    expect(world.connections).toEqual([]);
    expect(world.portals).toEqual([]);
    expect(() => validateGraph(world)).not.toThrow();
  });
});
