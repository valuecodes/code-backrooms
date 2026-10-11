import type { CallSite, CodeGraph } from "@repo/code-graph";
import { describe, expect, it } from "vitest";

import { buildCodeGraph, hashSource } from "./parser";
import type { SourceFile } from "./parser";

const filesOf = (
  files: Readonly<Record<string, string>>
): readonly SourceFile[] =>
  Object.entries(files).map(([path, source]) => ({ path, source }));

const siteOf = (graph: CodeGraph, calleeName: string): CallSite => {
  const site = graph.callSites.find((item) => item.calleeName === calleeName);
  if (site === undefined) {
    throw new Error(`no call to ${calleeName}`);
  }
  return site;
};

const json = (value: unknown): string => JSON.stringify(value);

/** A two-package workspace: an app using `@repo/lib` and its own `~/` alias. */
const workspace = {
  "package.json": json({ name: "root", private: true }),
  "apps/web/package.json": json({
    name: "web",
    dependencies: { "@repo/lib": "workspace:*", lodash: "4.17.21" },
  }),
  "apps/web/tsconfig.json": [
    "{",
    "  // aliases",
    '  "compilerOptions": { "paths": { "~/*": ["./src/*"] } },',
    "}",
  ].join("\n"),
  "apps/web/src/app.ts": [
    'import { run } from "@repo/lib";',
    'import { helper } from "@repo/lib/sub";',
    'import { show } from "~/hud";',
    'import { debounce } from "lodash";',
    "export function main() { run(); helper(); show(); debounce(); }",
  ].join("\n"),
  "apps/web/src/hud.ts": "export function show() {}",
  "packages/lib/package.json": json({
    name: "@repo/lib",
    exports: { ".": "./src/lib.ts", "./sub": "./src/sub.ts" },
  }),
  "packages/lib/src/lib.ts": [
    'export * from "./more";',
    "export function run() {}",
  ].join("\n"),
  "packages/lib/src/more.ts": "export function more() {}",
  "packages/lib/src/sub.ts": "export function helper() {}",
};

describe("linking through packages", () => {
  const graph = buildCodeGraph(filesOf(workspace));

  it("keeps manifests away from the parser and out of the modules", () => {
    expect(graph.modules.map((module) => module.id)).toEqual([
      "apps/web/src/app.ts",
      "apps/web/src/hud.ts",
      "packages/lib/src/lib.ts",
      "packages/lib/src/more.ts",
      "packages/lib/src/sub.ts",
    ]);
    expect(graph.packages?.map((pkg) => [pkg.id, pkg.dir, pkg.deps])).toEqual([
      ["root", "", []],
      ["web", "apps/web", ["@repo/lib"]],
      ["@repo/lib", "packages/lib", []],
    ]);
  });

  it("resolves package, subpath and alias imports with call edges", () => {
    const [app] = graph.modules;
    expect(app?.imports.map((record) => record.moduleId)).toEqual([
      "packages/lib/src/lib.ts",
      "packages/lib/src/sub.ts",
      "apps/web/src/hud.ts",
      null,
    ]);
    expect(siteOf(graph, "run")).toMatchObject({
      resolution: "resolved",
      calleeId: "packages/lib/src/lib.ts::run",
    });
    expect(siteOf(graph, "helper").calleeId).toBe(
      "packages/lib/src/sub.ts::helper"
    );
    expect(siteOf(graph, "show").calleeId).toBe("apps/web/src/hud.ts::show");
    const calls = graph.edges.flatMap((edge) =>
      edge.type === "call" ? [edge.target] : []
    );
    expect(calls).toEqual([
      "packages/lib/src/lib.ts::run",
      "packages/lib/src/sub.ts::helper",
      "apps/web/src/hud.ts::show",
    ]);
  });

  it("leaves an npm package unresolved, keeping via", () => {
    expect(siteOf(graph, "debounce")).toMatchObject({
      resolution: "unresolved",
      calleeId: null,
      via: { localName: "debounce", member: null, isNew: false },
    });
  });

  it("follows a star re-export across a package import", () => {
    const linked = buildCodeGraph(
      filesOf({
        ...workspace,
        "apps/web/src/hud.ts": [
          'import { more } from "@repo/lib";',
          "export function show() { more(); }",
        ].join("\n"),
      })
    );
    expect(siteOf(linked, "more").calleeId).toBe(
      "packages/lib/src/more.ts::more"
    );
  });

  it("without manifests, links only relative imports and has no packages", () => {
    const sources = Object.fromEntries(
      Object.entries(workspace).filter(([path]) => path.endsWith(".ts"))
    );
    const plain = buildCodeGraph(filesOf(sources));
    expect(plain).not.toHaveProperty("packages");
    expect(plain.modules[0]?.imports.map((record) => record.moduleId)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(siteOf(plain, "run").resolution).toBe("unresolved");
  });

  it("does not depend on the order the files come in", () => {
    const files = filesOf(workspace);
    expect(buildCodeGraph(files.toReversed())).toEqual(graph);
  });

  it("rejects a manifest path given twice, as it does a source", () => {
    const files = filesOf(workspace);
    const manifest = files.find((file) => file.path === "package.json");
    if (manifest === undefined) {
      throw new Error("Expected the root manifest");
    }
    expect(() => buildCodeGraph([...files, manifest])).toThrow(
      'Duplicate module path "package.json"'
    );
  });

  it("changes the seed when a manifest changes", () => {
    const files = filesOf(workspace);
    const renamed = filesOf({
      ...workspace,
      "packages/lib/package.json": json({ name: "@repo/lib2" }),
    });
    expect(hashSource(renamed)).not.toBe(hashSource(files));
  });
});
