import type { WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { checkLayout } from "@repo/world-generator/layout-checks";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph } from "./fixture";
import { classId } from "./ids";
import { toWorldGraph } from "./world-graph";

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

/** Plain connections (no call doors) as `from -> to`. */
const plain = (world: WorldGraph) =>
  world.connections
    .filter((connection) => connection.kind === undefined)
    .map(({ from, to }) => `${from} -> ${to}`);

const lobbiesOf = (world: WorldGraph) =>
  world.rooms.filter((room) => room.id.includes("//class:"));

const methods = (className: string, names: readonly string[]) =>
  names.map((name) => ({ name, className, lines: 1 }));

describe("class lobbies", () => {
  it("hangs a class's root methods off one lobby behind one door of the hub", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [{ name: "main" }, ...methods("Svc", ["a", "b", "c"])],
    });
    const world = toWorldGraph(graph);
    expect(lobbiesOf(world)).toEqual([
      expect.objectContaining({
        id: "m.ts//class:Svc",
        label: "class Svc",
        hub: true,
      }),
    ]);
    expect(plain(world)).toEqual([
      "m.ts -> m.ts::main",
      "m.ts -> m.ts//class:Svc",
      "m.ts//class:Svc -> m.ts::Svc.a",
      "m.ts//class:Svc -> m.ts::Svc.b",
      "m.ts//class:Svc -> m.ts::Svc.c",
    ]);
    // Returns still land at the module hub, not the lobby.
    expect(
      (world.portals ?? [])
        .filter((portal) => portal.kind === "return")
        .map((portal) => portal.to)
    ).toEqual(["m.ts", "m.ts", "m.ts", "m.ts"]);
    laysOutCleanly(graph);
  });

  it("chains further lobbies when a class has many root methods", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const graph = fixtureGraph({
      path: "m.ts",
      functions: methods("Svc", names),
    });
    const world = toWorldGraph(graph);
    expect(lobbiesOf(world).map((room) => room.id)).toEqual([
      "m.ts//class:Svc",
      "m.ts//class:Svc#2",
    ]);
    expect(plain(world)).toEqual([
      "m.ts -> m.ts//class:Svc",
      "m.ts//class:Svc -> m.ts//class:Svc#2",
      ...["a", "b", "c"].map((name) => `m.ts//class:Svc -> m.ts::Svc.${name}`),
      ...["d", "e", "f", "g"].map(
        (name) => `m.ts//class:Svc#2 -> m.ts::Svc.${name}`
      ),
    ]);
    for (const lobby of lobbiesOf(world)) {
      const doors = world.connections.filter(
        ({ from, to }) => from === lobby.id || to === lobby.id
      );
      expect(doors.length).toBeLessThanOrEqual(5);
    }
    laysOutCleanly(graph);
  });

  it("keeps the call door of a method another function calls", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "main", calls: ["Svc.a"] },
        ...methods("Svc", ["a", "b"]),
      ],
    });
    const world = toWorldGraph(graph);
    expect(world.connections).toContainEqual({
      from: "m.ts::main",
      to: "m.ts::Svc.a",
      kind: "call",
    });
    expect(plain(world)).toEqual([
      "m.ts -> m.ts::main",
      "m.ts -> m.ts//class:Svc",
      "m.ts//class:Svc -> m.ts::Svc.b",
    ]);
    laysOutCleanly(graph);
  });

  it("gives no lobby to a class whose methods are all reached by doors", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "main", calls: ["Svc.a", "Svc.b"] },
        ...methods("Svc", ["a", "b"]),
      ],
    });
    const world = toWorldGraph(graph);
    expect(lobbiesOf(world)).toEqual([]);
    expect(plain(world)).toEqual(["m.ts -> m.ts::main"]);
    laysOutCleanly(graph);
  });

  it("puts each lobby at its first method's place among the hub's doors", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "f", lines: 1 },
        { name: "x", className: "A", lines: 1 },
        { name: "g", lines: 1 },
        { name: "y", className: "B", lines: 1 },
        { name: "z", className: "A", lines: 1 },
      ],
    });
    const world = toWorldGraph(graph);
    expect(plain(world)).toEqual([
      "m.ts -> m.ts::f",
      "m.ts -> m.ts//class:A",
      "m.ts -> m.ts::g",
      "m.ts -> m.ts//class:B",
      "m.ts//class:A -> m.ts::A.x",
      "m.ts//class:A -> m.ts::A.z",
      "m.ts//class:B -> m.ts::B.y",
    ]);
    laysOutCleanly(graph);
  });

  it("leaves the methods of a class that is not top-level on the hub", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: methods("Svc", ["a", "b"]),
    });
    const nested = {
      ...graph,
      classes: graph.classes.map((cls) => ({ ...cls, topLevel: false })),
    };
    const world = toWorldGraph(nested);
    expect(lobbiesOf(world)).toEqual([]);
    expect(plain(world)).toEqual([
      "m.ts -> m.ts::Svc.a",
      "m.ts -> m.ts::Svc.b",
    ]);
  });

  it("tells two declarations of one class name apart by their spans", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: methods("Svc", ["a", "b"]),
    });
    const [a, b] = graph.functions;
    const [svc] = graph.classes;
    if (a === undefined || b === undefined || svc === undefined) {
      throw new Error("fixture lost its functions");
    }
    // `if (x) { class Svc { a() {} } } else { class Svc { b() {} } }`
    const split = {
      ...graph,
      classes: [
        { ...svc, span: a.span },
        { ...svc, id: classId("m.ts", "Svc~2"), span: b.span },
      ],
    };
    const world = toWorldGraph(split);
    expect(plain(world)).toEqual([
      "m.ts -> m.ts//class:Svc",
      "m.ts -> m.ts//class:Svc~2",
      "m.ts//class:Svc -> m.ts::Svc.a",
      "m.ts//class:Svc~2 -> m.ts::Svc.b",
    ]);
    laysOutCleanly(split);
  });
});
