import { describe, expect, it } from "vitest";

import { callIndexOf } from "./call-index";
import type { CallLink } from "./call-index";
import type { CallSite, CodeGraph, FunctionNode } from "./code-graph";
import { demoGraph, fixtureGraph } from "./fixture";

const names = (links: readonly CallLink[]) =>
  links.map((link) => link.fn.qualifiedName);

const groupNames = (groups: readonly (readonly FunctionNode[])[]) =>
  groups.map((group) => group.map((fn) => fn.qualifiedName));

/** `fnId` calls one of `candidates`, which the analysis cannot tell apart. */
const ambiguous = (
  graph: CodeGraph,
  fnId: string,
  offset: number,
  candidates: readonly string[]
): CallSite => {
  const caller = graph.functions.find((fn) => fn.id === fnId);
  if (caller === undefined) {
    throw new Error(`No function "${fnId}"`);
  }
  return {
    id: `${fnId}@${caller.span.start + offset}`,
    callerId: fnId,
    calleeName: "shape.render",
    calleeId: null,
    resolution: "ambiguous",
    candidateIds: candidates.map((name) => `shapes.ts::${name}`),
    kind: "call",
    awaited: false,
    span: caller.span,
  };
};

/** `draw` makes two ambiguous calls over the same shapes, `paint` one over others. */
const shapes = (): CodeGraph => {
  const graph = fixtureGraph({
    path: "shapes.ts",
    functions: [
      { name: "draw" },
      { name: "paint" },
      { name: "Square.render" },
      { name: "Circle.render" },
      { name: "Line.render" },
    ],
  });
  return {
    ...graph,
    callSites: [
      ...graph.callSites,
      ambiguous(graph, "shapes.ts::draw", 1, [
        "Square.render",
        "Circle.render",
      ]),
      ambiguous(graph, "shapes.ts::draw", 2, [
        "Circle.render",
        "Square.render",
      ]),
      ambiguous(graph, "shapes.ts::draw", 3, ["Line.render", "Circle.render"]),
      ambiguous(graph, "shapes.ts::paint", 1, ["Line.render", "missing"]),
    ],
  };
};

describe("callIndexOf", () => {
  it("lists a function's callers and callees from the call edges", () => {
    const index = callIndexOf(demoGraph());
    expect(names(index.calleesOf("demo.ts::main"))).toEqual([
      "getUser",
      "showDashboard",
      "showLogin",
    ]);
    expect(names(index.callersOf("demo.ts::getUser"))).toEqual(["main"]);
    expect(names(index.calleesOf("demo.ts::getUser"))).toEqual(["loadSession"]);
    expect(index.callersOf("demo.ts::main")).toEqual([]);
  });

  it("sorts by qualified name, not call order", () => {
    const index = callIndexOf(
      fixtureGraph({
        path: "a.ts",
        functions: [
          { name: "zeta", calls: ["omega"] },
          { name: "alpha", calls: ["omega"] },
          { name: "omega" },
        ],
      })
    );
    expect(names(index.callersOf("a.ts::omega"))).toEqual(["alpha", "zeta"]);
  });

  it("flags a function calling itself on both sides", () => {
    const index = callIndexOf(
      fixtureGraph({
        path: "a.ts",
        functions: [
          { name: "main", calls: ["count"] },
          { name: "count", calls: ["count"] },
        ],
      })
    );
    expect(index.callersOf("a.ts::count")).toEqual([
      expect.objectContaining({ recursive: true }),
      expect.objectContaining({ recursive: false }),
    ]);
    expect(names(index.callersOf("a.ts::count"))).toEqual(["count", "main"]);
    expect(index.calleesOf("a.ts::count")).toEqual([
      expect.objectContaining({ recursive: true }),
    ]);
  });

  it("groups an ambiguous call's candidates, once per set", () => {
    const index = callIndexOf(shapes());
    expect(groupNames(index.maybeCalleesOf("shapes.ts::draw"))).toEqual([
      ["Circle.render", "Line.render"],
      ["Circle.render", "Square.render"],
    ]);
    // An unknown candidate leaves one: no choice left to show.
    expect(index.maybeCalleesOf("shapes.ts::paint")).toEqual([]);
    expect(index.calleesOf("shapes.ts::draw")).toEqual([]);
  });

  it("knows nothing of an unknown function", () => {
    const index = callIndexOf(demoGraph());
    expect(index.callersOf("nope")).toEqual([]);
    expect(index.calleesOf("nope")).toEqual([]);
    expect(index.maybeCalleesOf("nope")).toEqual([]);
  });

  it("builds one index per graph", () => {
    const graph = demoGraph();
    expect(callIndexOf(graph)).toBe(callIndexOf(graph));
    expect(callIndexOf(demoGraph())).not.toBe(callIndexOf(graph));
  });
});
