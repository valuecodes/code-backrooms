import { describe, expect, it } from "vitest";

import { areaParentsOf } from "./area-parents";
import type { CodeGraph } from "./code-graph";
import { fixtureGraph, importOf, packageNode, withPackages } from "./fixture";
import { ENTRANCE_ID } from "./ids";

const MAIN = "apps/web/src/main.ts";
const UTIL = "apps/web/src/util.ts";
const LOAD = "packages/lib/src/load.ts";
const PARSE = "packages/lib/src/parse.ts";
const WEB = "//zone:web";
const LIB = "//zone:@repo/lib";

/** An app importing its util and a library, each with two modules. */
const workspace = (): CodeGraph =>
  withPackages(
    fixtureGraph(
      {
        path: MAIN,
        functions: [{ name: "main", calls: [`${LOAD}::load`] }],
        imports: [importOf(UTIL, "util"), importOf(LOAD, "load")],
      },
      { path: UTIL, functions: [{ name: "util" }] },
      {
        path: LOAD,
        functions: [{ name: "load", calls: [`${PARSE}::parse`] }],
        imports: [importOf(PARSE, "parse")],
      },
      { path: PARSE, functions: [{ name: "parse" }] }
    ),
    packageNode("web", "apps/web", ["@repo/lib"]),
    packageNode("@repo/lib", "packages/lib")
  );

/** Every area's chain of parents up to the entrance; throws on a cycle. */
const depthOf = (parents: ReadonlyMap<string, string>, id: string): number => {
  let depth = 0;
  for (let at = id; at !== ENTRANCE_ID; depth += 1) {
    const parent = parents.get(at);
    if (parent === undefined || depth > parents.size) {
      throw new Error(`${id} does not lead to the entrance`);
    }
    at = parent;
  }
  return depth;
};

describe("areaParentsOf", () => {
  it("hangs zone hubs off the entrance and modules off their own zone", () => {
    expect([...areaParentsOf(workspace())]).toEqual([
      [WEB, ENTRANCE_ID],
      [LIB, ENTRANCE_ID],
      [MAIN, WEB],
      [LOAD, LIB],
      [UTIL, MAIN],
      [PARSE, LOAD],
    ]);
  });

  it("hangs entry modules off the entrance without zones", () => {
    const graph = fixtureGraph(
      {
        path: "a.ts",
        functions: [{ name: "a" }],
        imports: [importOf("b.ts", "b")],
      },
      { path: "b.ts", functions: [{ name: "b" }] },
      { path: "c.ts", functions: [{ name: "c" }] }
    );
    expect([...areaParentsOf(graph)]).toEqual([
      ["a.ts", ENTRANCE_ID],
      ["c.ts", ENTRANCE_ID],
      ["b.ts", "a.ts"],
    ]);
  });

  it("is a tree over every area, the entrance its root", () => {
    const graph = workspace();
    const parents = areaParentsOf(graph);
    expect(parents.has(ENTRANCE_ID)).toBe(false);
    for (const module of graph.modules) {
      expect(depthOf(parents, module.id)).toBeGreaterThan(0);
    }
    expect(areaParentsOf(graph)).toBe(parents);
  });
});
