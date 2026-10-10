import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { entryModules } from "./entrypoints";
import { demoGraph, fixtureGraph, importOf } from "./fixture";

const idsOf = (graph: CodeGraph): readonly string[] =>
  entryModules(graph).map((module) => module.id);

/** `count` exported functions nobody calls. */
const api = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `f${index}`,
    exported: true,
  }));

describe("entryModules", () => {
  it("returns the one module of a one-module graph", () => {
    expect(idsOf(demoGraph())).toEqual(["demo.ts"]);
  });

  it("ranks an index above a leaf nobody imports", () => {
    const graph = fixtureGraph(
      { path: "src/a.ts", functions: [{ name: "one" }] },
      { path: "src/index.ts", functions: [{ name: "main" }] }
    );
    expect(idsOf(graph)).toEqual(["src/index.ts", "src/a.ts"]);
  });

  it("leads to an un-imported cli.ts, not to the index it imports", () => {
    const graph = fixtureGraph(
      {
        path: "src/cli.ts",
        functions: [{ name: "run" }],
        imports: [importOf("src/index.ts")],
      },
      { path: "src/index.ts", functions: [{ name: "main" }] }
    );
    expect(idsOf(graph)).toEqual(["src/cli.ts"]);
  });

  it("counts exported functions nobody calls, up to three", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: api(2) },
      { path: "b.ts", functions: api(5) },
      {
        path: "c.ts",
        functions: [
          { name: "called", exported: true },
          { name: "caller", calls: ["called"] },
        ],
      },
      { path: "d.ts", functions: api(3) }
    );
    // b and d tie at three, a has two, c's export is called.
    expect(idsOf(graph)).toEqual(["b.ts", "d.ts", "a.ts", "c.ts"]);
  });

  it("ranks a shallower module first and breaks a tie by path", () => {
    const graph = fixtureGraph(
      { path: "src/deep/nested/main.ts", functions: [] },
      { path: "src/z/main.ts", functions: [] },
      { path: "src/b/main.ts", functions: [] },
      { path: "src/main.ts", functions: [] }
    );
    expect(idsOf(graph)).toEqual([
      "src/main.ts",
      "src/b/main.ts",
      "src/z/main.ts",
      "src/deep/nested/main.ts",
    ]);
  });

  it("does not depend on the order of the modules", () => {
    const util = {
      path: "lib/util.ts",
      functions: [{ name: "u", exported: true }],
    };
    const app = { path: "src/app.ts", functions: [] };
    const cli = { path: "src/cli.ts", functions: [] };
    const tool = { path: "tools/x.ts", functions: [] };
    const expected = idsOf(fixtureGraph(util, app, cli, tool));
    expect(expected).toEqual([
      "src/app.ts",
      "src/cli.ts",
      "lib/util.ts",
      "tools/x.ts",
    ]);
    expect(idsOf(fixtureGraph(tool, cli, app, util))).toEqual(expected);
    expect(idsOf(fixtureGraph(cli, util, tool, app))).toEqual(expected);
  });

  it("leads into a cycle nobody else imports exactly once", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [], imports: [importOf("b.ts")] },
      { path: "b.ts", functions: [], imports: [importOf("c.ts")] },
      { path: "c.ts", functions: [], imports: [importOf("a.ts")] },
      { path: "main.ts", functions: [], imports: [importOf("d.ts")] },
      { path: "d.ts", functions: [], imports: [importOf("main.ts")] }
    );
    // main.ts wins its cycle by name; a.ts, b.ts, c.ts tie and a.ts is first.
    expect(idsOf(graph)).toEqual(["main.ts", "a.ts"]);
  });

  it("leads to every module nobody imports, however many", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `m${index}.ts`);
    const graph = fixtureGraph(
      ...paths.map((path) => ({ path, functions: [] }))
    );
    expect(idsOf(graph)).toEqual(paths);
  });
});
