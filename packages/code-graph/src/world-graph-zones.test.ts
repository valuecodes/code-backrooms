import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph, importOf, packageNode, withPackages } from "./fixture";
import { toWorldGraph } from "./world-graph";

/** An app calling into itself and into a library, importing both. */
const appAndLibrary = (): CodeGraph =>
  fixtureGraph(
    {
      path: "apps/web/src/main.ts",
      functions: [
        { name: "run", calls: ["packages/lib/src/load.ts::load", "helper"] },
        { name: "helper" },
      ],
      imports: [
        importOf("packages/lib/src/load.ts", "load"),
        importOf("apps/web/src/util.ts", "util"),
      ],
    },
    { path: "apps/web/src/util.ts", functions: [] },
    { path: "packages/lib/src/load.ts", functions: [{ name: "load" }] }
  );

/** `[to, label]` of the call and module portals of `module`'s world. */
const labelsOf = (graph: CodeGraph, moduleId: string) => {
  const module = graph.modules.find((candidate) => candidate.id === moduleId);
  return (toWorldGraph(graph, new Set(), null, module).portals ?? [])
    .filter(({ kind }) => kind === "call" || kind === "module")
    .map(({ kind, to, label }) => [kind, to, label]);
};

describe("toWorldGraph across zones", () => {
  it("names the package of a module or callee in another zone", () => {
    const graph = withPackages(
      appAndLibrary(),
      packageNode("web", "apps/web", ["@repo/lib"]),
      packageNode("@repo/lib", "packages/lib")
    );
    const labels = labelsOf(graph, "apps/web/src/main.ts");
    expect(labels).toContainEqual([
      "module",
      "packages/lib/src/load.ts",
      "@repo/lib · src/load.ts",
    ]);
    expect(labels).toContainEqual([
      "module",
      "apps/web/src/util.ts",
      "apps/web/src/util.ts",
    ]);
    const calls = labels.filter(([kind]) => kind === "call");
    expect(calls).toEqual([
      ["call", "packages/lib/src/load.ts::load", "@repo/lib · load"],
    ]);
  });

  it("labels a graph of one package exactly as one without packages", () => {
    const plain = appAndLibrary();
    const single = withPackages(plain, packageNode("mono", ""));
    for (const module of plain.modules) {
      expect(toWorldGraph(single, new Set(), 7, module)).toEqual(
        toWorldGraph(plain, new Set(), 7, module)
      );
    }
  });
});
