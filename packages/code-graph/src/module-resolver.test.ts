import { describe, expect, it } from "vitest";

import type { ExportEntry, PackageNode, PathAlias } from "./code-graph";
import { createResolver } from "./module-resolver";

const pkg = (
  name: string,
  dir: string,
  exports: readonly ExportEntry[],
  paths: readonly PathAlias[] = [],
  id = name
): PackageNode => ({ id, name, dir, exports, paths, deps: [] });

const modules = new Set([
  "apps/web/src/app.tsx",
  "apps/web/src/hud.tsx",
  "apps/web/src/lib/index.ts",
  "apps/web/src/shared.ts",
  "packages/code/src/code.ts",
  "packages/code-graph/src/code-graph.ts",
  "packages/code-graph/src/ids.ts",
  "packages/code-graph/src/internal.ts",
  "packages/legacy/index.ts",
  "packages/legacy/lib/util.ts",
  "packages/fallback/src/index.ts",
  "packages/dup/a.ts",
  "packages/dup2/a.ts",
  "shared/types.ts",
]);

const packages: readonly PackageNode[] = [
  pkg(
    "web",
    "apps/web",
    [],
    [
      { pattern: "~/*", targets: ["apps/web/src/*"] },
      { pattern: "~/shared", targets: ["shared/types.ts"] },
      { pattern: "@repo/*", targets: ["apps/web/vendor/*"] },
    ]
  ),
  pkg("@repo/code", "packages/code", [
    { subpath: ".", targets: ["packages/code/src/code.ts"] },
  ]),
  pkg("@repo/code-graph", "packages/code-graph", [
    { subpath: ".", targets: ["packages/code-graph/src/code-graph.ts"] },
    { subpath: "./internal", targets: [] },
    { subpath: "./*", targets: ["packages/code-graph/src/*.ts"] },
  ]),
  pkg("legacy", "packages/legacy", [
    { subpath: ".", targets: ["packages/legacy/index"] },
    { subpath: "./*", targets: ["packages/legacy/*"] },
  ]),
  pkg("fallback", "packages/fallback", [
    {
      subpath: ".",
      targets: [
        "packages/fallback/dist/index.js",
        "packages/fallback/src/index.ts",
      ],
    },
  ]),
  pkg("dup", "packages/dup", [
    { subpath: ".", targets: ["packages/dup/a.ts"] },
  ]),
  pkg(
    "dup",
    "packages/dup2",
    [{ subpath: ".", targets: ["packages/dup2/a.ts"] }],
    [],
    "dup~2"
  ),
];

const resolve = createResolver(modules, packages);
const fromApp = "apps/web/src/app.tsx";
const fromLib = "packages/code/src/code.ts";

describe("createResolver", () => {
  it("resolves relative specifiers as before", () => {
    expect(resolve(fromApp, "./hud")).toBe("apps/web/src/hud.tsx");
    expect(resolve(fromApp, "./lib")).toBe("apps/web/src/lib/index.ts");
    expect(resolve(fromApp, "../../../shared/types")).toBe("shared/types.ts");
    expect(resolve(fromApp, "./missing")).toBeNull();
  });

  it("resolves the importer's tsconfig paths, exact before patterns", () => {
    expect(resolve(fromApp, "~/hud")).toBe("apps/web/src/hud.tsx");
    expect(resolve(fromApp, "~/lib")).toBe("apps/web/src/lib/index.ts");
    expect(resolve(fromApp, "~/shared")).toBe("shared/types.ts");
    expect(resolve(fromApp, "~/missing")).toBeNull();
  });

  it("applies only the owning package's aliases", () => {
    expect(resolve(fromLib, "~/hud")).toBeNull();
  });

  it("falls through to packages when an alias target is absent", () => {
    expect(resolve(fromApp, "@repo/code")).toBe("packages/code/src/code.ts");
  });

  it("resolves a package's root, exact subpaths and patterns", () => {
    expect(resolve(fromApp, "@repo/code-graph")).toBe(
      "packages/code-graph/src/code-graph.ts"
    );
    expect(resolve(fromApp, "@repo/code-graph/ids")).toBe(
      "packages/code-graph/src/ids.ts"
    );
    expect(resolve(fromApp, "@repo/code-graph/missing")).toBeNull();
  });

  it("tells a package from one whose name is its prefix", () => {
    expect(resolve(fromApp, "@repo/code")).toBe("packages/code/src/code.ts");
    expect(resolve(fromApp, "@repo/code/ids")).toBeNull();
    expect(resolve(fromApp, "@repo/codex")).toBeNull();
  });

  it("lets a blocked exact subpath beat a matching pattern", () => {
    expect(resolve(fromApp, "@repo/code-graph/internal")).toBeNull();
  });

  it("reaches files of a package without exports by path", () => {
    expect(resolve(fromApp, "legacy")).toBe("packages/legacy/index.ts");
    expect(resolve(fromApp, "legacy/lib/util")).toBe(
      "packages/legacy/lib/util.ts"
    );
    expect(resolve(fromApp, "legacy/lib/util.js")).toBe(
      "packages/legacy/lib/util.ts"
    );
  });

  it("falls back to a later target when the first is absent", () => {
    expect(resolve(fromApp, "fallback")).toBe("packages/fallback/src/index.ts");
  });

  it("resolves a repeated name to the first package by dir", () => {
    expect(resolve(fromApp, "dup")).toBe("packages/dup/a.ts");
  });

  it("leaves other packages and builtins unresolved", () => {
    expect(resolve(fromApp, "lodash")).toBeNull();
    expect(resolve(fromApp, "node:fs")).toBeNull();
    expect(resolve(fromApp, "/abs/path")).toBeNull();
  });

  it("without packages, resolves only relative specifiers", () => {
    const plain = createResolver(modules, []);
    expect(plain(fromApp, "./hud")).toBe("apps/web/src/hud.tsx");
    expect(plain(fromApp, "~/hud")).toBeNull();
    expect(plain(fromApp, "@repo/code")).toBeNull();
  });
});
