import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph } from "./fixture";
import { moduleLinks } from "./module-links";

describe("moduleLinks with packages", () => {
  const base = fixtureGraph(
    {
      path: "apps/web/src/index.ts",
      functions: [],
      exports: [
        {
          exportedName: "*",
          localName: null,
          specifier: "@repo/lib",
          importedName: null,
        },
        {
          exportedName: "hud",
          localName: null,
          specifier: "~/hud",
          importedName: "hud",
        },
      ],
    },
    { path: "apps/web/src/hud.ts", functions: [] },
    { path: "packages/lib/src/lib.ts", functions: [] }
  );
  const [barrel] = base.modules;
  if (barrel === undefined) {
    throw new Error("Expected the barrel module");
  }

  it("follows re-exports through package names and aliases", () => {
    const graph: CodeGraph = {
      ...base,
      packages: [
        {
          id: "web",
          name: "web",
          dir: "apps/web",
          exports: [],
          paths: [{ pattern: "~/*", targets: ["apps/web/src/*"] }],
          deps: ["@repo/lib"],
        },
        {
          id: "@repo/lib",
          name: "@repo/lib",
          dir: "packages/lib",
          exports: [{ subpath: ".", targets: ["packages/lib/src/lib.ts"] }],
          paths: [],
          deps: [],
        },
      ],
    };
    expect(moduleLinks(graph, barrel)).toEqual([
      "packages/lib/src/lib.ts",
      "apps/web/src/hud.ts",
    ]);
  });

  it("leaves them out without packages", () => {
    expect(moduleLinks(base, barrel)).toEqual([]);
  });
});
