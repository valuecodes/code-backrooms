import type { CodeGraph, FlowStep } from "@repo/code-graph";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { ExampleName } from "./examples";
import { sourceView } from "./source-view";
import type { SourceView } from "./source-view";
import { codeGraphOf } from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const parsed = (name: "demo" | "loops") => {
  const result = codeGraphOf(name);
  if (result.error !== null) {
    throw new Error(`${name}: ${result.error}`);
  }
  return result;
};

/** The first top-level flow node of `fnId` of the given kind. */
const topLevel = (
  graph: CodeGraph,
  fnId: string,
  kind: FlowStep["kind"]
): FlowStep => {
  const found = graph.functions
    .find((fn) => fn.id === fnId)
    ?.flow.steps.find((node) => node.kind === kind);
  if (found === undefined) {
    throw new Error(`no ${kind} in ${fnId}`);
  }
  return found;
};

const markedLines = (view: SourceView | null): readonly number[] =>
  (view?.code ?? [])
    .filter((line) => line.marked !== "")
    .map((line) => line.number);

/** Every shown line, joined back, is the source line it claims to be. */
const expectWholeLines = (view: SourceView | null, source: string) => {
  const lines = source.split("\n");
  for (const line of view?.code ?? []) {
    expect(line.before + line.marked + line.after).toBe(lines[line.number - 1]);
  }
};

describe("sourceView", () => {
  const demo = parsed("demo");
  const loops = parsed("loops");

  it("keeps every example's source by its module id", () => {
    for (const name of Object.keys(examples) as readonly ExampleName[]) {
      const result = codeGraphOf(name);
      const files = examples[name];
      expect(result.codeGraph?.modules.length).toBe(files.length);
      for (const module of result.codeGraph?.modules ?? []) {
        const file = files.find((item) => item.path === module.path);
        expect(
          result.error === null ? result.sources.get(module.id) : null
        ).toBe(file?.source);
      }
    }
  });

  it("shows nothing for corridors, unknown ids and no graph", () => {
    expect(sourceView(demo.codeGraph, demo.sources, "corridor-1")).toBeNull();
    expect(
      sourceView(demo.codeGraph, demo.sources, "demo.ts::nobody")
    ).toBeNull();
    expect(sourceView(demo.codeGraph, demo.sources, null)).toBeNull();
    expect(sourceView(null, demo.sources, "demo.ts")).toBeNull();
    expect(sourceView(demo.codeGraph, new Map(), "demo.ts")).toBeNull();
  });

  it("shows a hub's whole file, nothing marked", () => {
    const view = sourceView(demo.codeGraph, demo.sources, "demo.ts");
    const lineCount = examples.demo[0].source.trimEnd().split("\n").length;
    expect(view).toMatchObject({
      path: "demo.ts",
      fn: null,
      region: null,
      lines: `1–${lineCount}`,
    });
    expect(view?.code).toHaveLength(lineCount);
    expect(markedLines(view)).toEqual([]);
    expectWholeLines(view, examples.demo[0].source);
  });

  it("shows a function room's whole function, nothing marked", () => {
    const view = sourceView(demo.codeGraph, demo.sources, "demo.ts::getUser");
    expect(view).toMatchObject({
      path: "demo.ts",
      fn: "getUser()",
      region: null,
      lines: "11–13",
    });
    expect(view?.code.map((line) => line.number)).toEqual([11, 12, 13]);
    expect(markedLines(view)).toEqual([]);
  });

  it("marks a flow room's code inside its function, split at the columns", () => {
    const fork = topLevel(demo.codeGraph, "demo.ts::main", "branch");
    const view = sourceView(demo.codeGraph, demo.sources, fork.id);
    expect(view).toMatchObject({ fn: "main()", lines: "4–8" });
    expect(view?.code.map((line) => line.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(markedLines(view)).toEqual([4, 5, 6, 7, 8]);
    expect(view?.code[3]).toEqual({
      number: 4,
      before: "  ",
      marked: "if (user) {",
      after: "",
    });
    expectWholeLines(view, examples.demo[0].source);
  });

  it("marks a loop's whole ring from its end room", () => {
    const ring = topLevel(loops.codeGraph, "loops.ts::main", "loop");
    const view = sourceView(loops.codeGraph, loops.sources, `${ring.id}:end`);
    expect(view).toMatchObject({ fn: "main()", lines: "3–8" });
    expect(markedLines(view)).toEqual([3, 4, 5, 6, 7, 8]);
    expectWholeLines(view, examples.loops[0].source);
  });
});
