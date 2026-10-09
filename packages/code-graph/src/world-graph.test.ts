import type { Connection, Portal } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { demoGraph, fixtureGraph } from "./fixture";
import { portalSubject, roomSubject, toWorldGraph } from "./world-graph";

const call = (from: string, to: string): Connection => ({
  from,
  to,
  kind: "call",
});

const returnPortal = (fn: string, hub: string): Portal => ({
  id: `return:${fn}`,
  kind: "return",
  from: fn,
  to: hub,
  label: "return",
});

/** The call portal for the first call from `caller` to `callee` in the graph. */
const callPortalOf = (
  graph: CodeGraph,
  caller: string,
  callee: string
): Portal | undefined => {
  const site = graph.callSites.find(
    (candidate) =>
      candidate.callerId === caller && candidate.calleeId === callee
  );
  return site === undefined
    ? undefined
    : {
        id: `portal:${site.id}`,
        kind: "call",
        from: caller,
        to: callee,
        label: graph.functions.find((fn) => fn.id === callee)?.name ?? callee,
      };
};

/** Lays the graph out for several seeds; nothing may be left unrealised. */
const laysOutCleanly = (graph: CodeGraph) => {
  const world = toWorldGraph(graph);
  expect(() => validateGraph(world)).not.toThrow();
  for (let seed = 1; seed <= 8; seed += 1) {
    const generated = generateWorld({ seed, graph: world });
    expect(generated.layout.unresolved, `seed ${seed}`).toEqual([]);
    expect(generated.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
  }
};

describe("toWorldGraph", () => {
  it("turns the reference demo into a hub, five rooms, call doors and return portals", () => {
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
    expect(world.rooms[0]?.hub).toBe(true);
    expect(world.rooms.slice(1).every((room) => room.hub === undefined)).toBe(
      true
    );
    expect(world.connections).toEqual([
      { from: "demo.ts", to: "demo.ts::main" },
      call("demo.ts::main", "demo.ts::getUser"),
      call("demo.ts::main", "demo.ts::showDashboard"),
      call("demo.ts::main", "demo.ts::showLogin"),
      call("demo.ts::getUser", "demo.ts::loadSession"),
    ]);
    expect(world.portals).toEqual(
      [
        "demo.ts::main",
        "demo.ts::getUser",
        "demo.ts::showDashboard",
        "demo.ts::showLogin",
        "demo.ts::loadSession",
      ].map((fn) => returnPortal(fn, "demo.ts"))
    );
    expect(world.start).toBe("demo.ts");
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("lays out as a world the generator accepts", () => {
    const generated = generateWorld({
      seed: 1,
      graph: toWorldGraph(demoGraph()),
    });
    expect(
      generated.layout.rooms.filter((room) => room.kind === "room")
    ).toHaveLength(6);
    expect(generated.layout.unresolved).toEqual([]);
    expect(generated.layout.unplacedPortals).toEqual([]);
    expect(generated.layout.startRoomId).toBe("demo.ts");
    expect(generated.built.portals).toHaveLength(5);
  });

  it("makes repeated calls one door and the reverse call a portal", () => {
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
    expect(world.portals).toEqual([
      callPortalOf(graph, "m.ts::b", "m.ts::a"),
      returnPortal("m.ts::a", "m.ts"),
      returnPortal("m.ts::b", "m.ts"),
    ]);
  });

  it("turns recursion into a portal back into the same room", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "a", calls: ["a"] }],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([{ from: "m.ts", to: "m.ts::a" }]);
    expect(world.portals?.[0]).toEqual(
      callPortalOf(graph, "m.ts::a", "m.ts::a")
    );
    laysOutCleanly(graph);
  });

  it("attaches only roots to the hub, whichever way the edges were written", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "x" }, { name: "main", calls: ["x"] }],
    });
    expect(toWorldGraph(graph).connections).toEqual([
      { from: "m.ts", to: "m.ts::main" },
      call("m.ts::main", "m.ts::x"),
    ]);
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
    expect(world.portals?.[0]).toEqual(
      callPortalOf(graph, "m.ts::b", "m.ts::a")
    );
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
    expect(world.portals?.slice(0, 2)).toEqual([
      callPortalOf(graph, "m.ts::a", "m.ts::c"),
      callPortalOf(graph, "m.ts::b", "m.ts::a"),
    ]);
    // A tree: one connection fewer than rooms, so the layout never fails.
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
    expect(world.portals?.[0]).toEqual(
      callPortalOf(graph, "m.ts::other", "m.ts::shared")
    );
  });

  it("caps the doors out of one room and sizes rooms for doors and portals", () => {
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
    expect(doorsOut).toHaveLength(5);
    const portalsOut = (world.portals ?? []).filter(
      (portal) => portal.kind === "call" && portal.from === "m.ts::caller"
    );
    expect(portalsOut.map((portal) => portal.to)).toEqual([
      "m.ts::g6",
      "m.ts::g7",
      "m.ts::g8",
    ]);
    // f reaches g6 and g7 first, so those two are doors; g1..g5 are portals.
    expect(
      world.connections
        .filter((connection) => connection.from === "m.ts::f")
        .map((connection) => connection.to)
    ).toEqual(["m.ts::g6", "m.ts::g7"]);
    expect(
      (world.portals ?? []).filter((portal) => portal.from === "m.ts::f")
    ).toHaveLength(6);
    const perimeter = (id: string) => {
      const room = world.rooms.find((candidate) => candidate.id === id);
      return 2 * ((room?.width ?? 0) + (room?.depth ?? 0));
    };
    // Doors cost 8 m of perimeter each, portals 3 m: caller has 6 doors
    // (hub + 5) and 4 portals, f has 3 doors (hub + 2) and 6 portals.
    expect(perimeter("m.ts::caller")).toBeGreaterThanOrEqual(60);
    expect(perimeter("m.ts::f")).toBeGreaterThanOrEqual(42);
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
    expect(world.portals).toEqual([
      returnPortal("a.ts::one", "a.ts"),
      returnPortal("b.ts::two", "b.ts"),
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
    expect(world.portals).toEqual(
      functions.map((fn) => returnPortal(`m.ts::${fn.name}`, "m.ts"))
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

describe("roomSubject", () => {
  const graph = demoGraph();

  it("names modules and functions, and nothing else", () => {
    expect(roomSubject(graph, "demo.ts")).toMatchObject({
      kind: "module",
      module: { path: "demo.ts" },
    });
    expect(roomSubject(graph, "demo.ts::getUser")).toMatchObject({
      kind: "function",
      fn: { name: "getUser" },
      module: { path: "demo.ts" },
    });
    expect(roomSubject(graph, "corridor-1")).toBeNull();
    expect(roomSubject(graph, "other.ts::getUser")).toBeNull();
  });
});

describe("portalSubject", () => {
  const graph = fixtureGraph({
    path: "m.ts",
    functions: [
      { name: "main", calls: ["shared"] },
      { name: "other", calls: ["shared"] },
      { name: "shared" },
    ],
  });

  it("names the call site and both functions of a call portal", () => {
    const portal = callPortalOf(graph, "m.ts::other", "m.ts::shared");
    expect(portalSubject(graph, portal?.id ?? "")).toMatchObject({
      kind: "call",
      site: { callerId: "m.ts::other" },
      caller: { name: "other" },
      callee: { name: "shared" },
    });
  });

  it("names the function of a return portal", () => {
    expect(portalSubject(graph, "return:m.ts::shared")).toMatchObject({
      kind: "return",
      fn: { name: "shared" },
    });
  });

  it("returns null for anything else", () => {
    expect(portalSubject(graph, "corridor-1")).toBeNull();
    expect(portalSubject(graph, "portal:m.ts::nobody@1")).toBeNull();
    expect(portalSubject(graph, "return:m.ts::nobody")).toBeNull();
  });
});
