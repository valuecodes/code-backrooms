import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph, packageNode, withPackages } from "./fixture";
import { awayZone, zonedPath } from "./zone-labels";

/** An app, a library and a script no package owns. */
const modules = (): CodeGraph =>
  fixtureGraph(
    { path: "apps/web/src/main.ts", functions: [] },
    { path: "apps/web/src/util.ts", functions: [] },
    { path: "packages/lib/src/load.ts", functions: [] },
    { path: "scripts/build.ts", functions: [] }
  );

const zoned = (): CodeGraph =>
  withPackages(
    modules(),
    packageNode("web", "apps/web"),
    packageNode("@repo/lib", "packages/lib")
  );

const moduleOf = (graph: CodeGraph, id: string) => {
  const module = graph.modules.find((candidate) => candidate.id === id);
  if (module === undefined) {
    throw new Error(`no module ${id}`);
  }
  return module;
};

describe("awayZone", () => {
  const graph = zoned();

  it("is null within a zone", () => {
    expect(
      awayZone(graph, "apps/web/src/main.ts", "apps/web/src/util.ts")
    ).toBeNull();
  });

  it("is the target's zone across zones, the unowned one included", () => {
    expect(
      awayZone(graph, "apps/web/src/main.ts", "packages/lib/src/load.ts")
    ).toMatchObject({ id: "//zone:@repo/lib", name: "@repo/lib" });
    expect(
      awayZone(graph, "apps/web/src/main.ts", "scripts/build.ts")
    ).toMatchObject({ id: "//zone", pkg: null });
  });

  it("is null for ids not from the graph", () => {
    expect(awayZone(graph, "apps/web/src/main.ts", "nope.ts")).toBeNull();
    expect(awayZone(graph, "nope.ts", "packages/lib/src/load.ts")).toBeNull();
  });
});

describe("zonedPath", () => {
  it("names a module inside its package when there are several zones", () => {
    const graph = zoned();
    expect(zonedPath(graph, moduleOf(graph, "apps/web/src/main.ts"))).toBe(
      "web · src/main.ts"
    );
    expect(zonedPath(graph, moduleOf(graph, "packages/lib/src/load.ts"))).toBe(
      "@repo/lib · src/load.ts"
    );
  });

  it("keeps the whole path in the zone no package owns", () => {
    const graph = zoned();
    // No root package and no shared directory: the repository's name.
    expect(zonedPath(graph, moduleOf(graph, "scripts/build.ts"))).toBe(
      "repository · scripts/build.ts"
    );
  });

  it("is the plain path with one zone or none", () => {
    const plain = modules();
    const single = withPackages(plain, packageNode("mono", ""));
    for (const graph of [plain, single]) {
      expect(zonedPath(graph, moduleOf(graph, "apps/web/src/main.ts"))).toBe(
        "apps/web/src/main.ts"
      );
    }
  });
});
