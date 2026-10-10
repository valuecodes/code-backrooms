import type { Portal } from "@repo/types";
import { validateGraph } from "@repo/world-generator/graph";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph, importOf } from "./fixture";
import { parseFlowNodeId } from "./ids";
import { moduleLinks, toWorldGraph } from "./world-graph";

/** A portal by kind, owning function, target and label; its room varies. */
const shape = (portal: Portal) => [
  portal.kind,
  parseFlowNodeId(portal.from)?.functionId ?? portal.from,
  portal.to,
  portal.label,
];

const returnShape = (fn: string, hub: string) => ["return", fn, hub, "return"];

const callShape = (graph: CodeGraph, caller: string, callee: string) => [
  "call",
  caller,
  callee,
  graph.functions.find((fn) => fn.id === callee)?.name ?? callee,
];

describe("toWorldGraph across modules", () => {
  it("links imported modules with module portals and marks them external", () => {
    const graph = fixtureGraph(
      {
        path: "a.ts",
        functions: [{ name: "one", calls: ["b.ts::two"] }],
        imports: [importOf("b.ts", "two"), importOf("c.ts"), importOf("b.ts")],
      },
      { path: "b.ts", functions: [{ name: "two" }] },
      { path: "c.ts", functions: [] }
    );
    const world = toWorldGraph(graph);
    expect(world.start).toBe("a.ts");
    expect(world.connections).toEqual([{ from: "a.ts", to: "a.ts::one" }]);
    expect(world.portals?.map(shape)).toEqual([
      callShape(graph, "a.ts::one", "b.ts::two"),
      returnShape("a.ts::one", "a.ts"),
      ["module", "a.ts", "b.ts", "b.ts"],
      ["module", "a.ts", "c.ts", "c.ts"],
    ]);
    expect(world.portals?.filter(({ kind }) => kind === "module")).toEqual([
      expect.objectContaining({ id: "module:a.ts>b.ts" }),
      expect.objectContaining({ id: "module:a.ts>c.ts" }),
    ]);
    expect(world.external).toEqual(["b.ts", "b.ts::two", "c.ts"]);
    expect(() => validateGraph(world)).not.toThrow();
    const second = toWorldGraph(graph, new Set(), null, graph.modules[1]);
    expect(second.rooms.map((room) => room.id)).toEqual(["b.ts", "b.ts::two"]);
    expect(second.start).toBe("b.ts");
    expect(second).not.toHaveProperty("external");
  });

  it("links a barrel to the files it re-exports from", () => {
    const graph = fixtureGraph(
      {
        path: "lib/index.ts",
        functions: [],
        exports: [
          {
            exportedName: "*",
            localName: null,
            specifier: "./a",
            importedName: null,
          },
          {
            exportedName: "b",
            localName: null,
            specifier: "./b.js",
            importedName: "b",
          },
          {
            exportedName: "c",
            localName: null,
            specifier: "lodash",
            importedName: "c",
          },
        ],
      },
      { path: "lib/a.ts", functions: [] },
      { path: "lib/b.ts", functions: [] }
    );
    const [barrel] = graph.modules;
    if (barrel === undefined) {
      throw new Error("Expected the barrel module");
    }
    expect(moduleLinks(graph, barrel)).toEqual(["lib/a.ts", "lib/b.ts"]);
  });

  it("links extra modules too, but never a module to itself", () => {
    const graph = fixtureGraph(
      {
        path: "a.ts",
        functions: [{ name: "one" }],
        imports: [importOf("a.ts"), importOf("missing.ts")],
      },
      { path: "b.ts", functions: [] }
    );
    expect(toWorldGraph(graph).portals?.map(shape)).toEqual([
      returnShape("a.ts::one", "a.ts"),
    ]);
    const linked = toWorldGraph(graph, new Set(), null, graph.modules[0], [
      "b.ts",
      "a.ts",
    ]);
    expect(linked.external).toEqual(["b.ts"]);
    expect(() => validateGraph(linked)).not.toThrow();
  });
});
