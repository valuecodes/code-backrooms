import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { describe, expect, it } from "vitest";

import { demoGraph, fixtureGraph } from "./fixture";
import { roomSubject, toWorldGraph } from "./world-graph";

describe("toWorldGraph", () => {
  it("turns the reference demo into a hub and five labelled rooms", () => {
    const world = toWorldGraph(demoGraph());
    expect(world.rooms.map((room) => [room.id, room.label])).toEqual([
      ["demo.ts", "demo.ts"],
      ["demo.ts::main", "main"],
      ["demo.ts::getUser", "getUser"],
      ["demo.ts::showDashboard", "showDashboard"],
      ["demo.ts::showLogin", "showLogin"],
      ["demo.ts::loadSession", "loadSession"],
    ]);
    expect(world.connections).toEqual([
      { from: "demo.ts", to: "demo.ts::main" },
      { from: "demo.ts::main", to: "demo.ts::getUser" },
      { from: "demo.ts::main", to: "demo.ts::showDashboard" },
      { from: "demo.ts::main", to: "demo.ts::showLogin" },
      { from: "demo.ts::getUser", to: "demo.ts::loadSession" },
    ]);
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
    expect(generated.layout.startRoomId).toBe("demo.ts");
  });

  it("merges repeated and reversed calls into one door", () => {
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
      { from: "m.ts::a", to: "m.ts::b" },
    ]);
  });

  it("drops recursion but keeps the function reachable", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "a", calls: ["a"] }],
    });
    expect(toWorldGraph(graph).connections).toEqual([
      { from: "m.ts", to: "m.ts::a" },
    ]);
  });

  it("attaches only roots to the hub, whichever way the edges were written", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "x" }, { name: "main", calls: ["x"] }],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toEqual([
      { from: "m.ts", to: "m.ts::main" },
      { from: "m.ts::main", to: "m.ts::x" },
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
      { from: "m.ts::a", to: "m.ts::b" },
    ]);
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("sizes rooms by their number of doors", () => {
    const callers = Array.from({ length: 7 }, (_, index) => ({
      name: `caller${index}`,
      calls: ["shared"],
    }));
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "shared", lines: 1 }, ...callers],
    });
    const shared = toWorldGraph(graph).rooms.find(
      (room) => room.label === "shared"
    );
    expect(shared).toBeDefined();
    expect((shared?.width ?? 0) + (shared?.depth ?? 0)).toBeGreaterThanOrEqual(
      28
    );
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
    expect(() => validateGraph(world)).not.toThrow();
    for (let seed = 1; seed <= 8; seed += 1) {
      expect(() => generateWorld({ seed, graph: world })).not.toThrow();
    }
    expect(roomSubject(graph, "m.ts#3")).toMatchObject({
      kind: "module",
      module: { path: "m.ts" },
    });
  });

  it("gives an empty module a hub only", () => {
    const world = toWorldGraph(fixtureGraph({ path: "e.ts", functions: [] }));
    expect(world.rooms.map((room) => room.id)).toEqual(["e.ts"]);
    expect(world.connections).toEqual([]);
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
