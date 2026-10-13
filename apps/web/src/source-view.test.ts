import type { CodeGraph, FlowStep } from "@repo/code-graph";
import type { SourceFile } from "@repo/parser";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { BundledName } from "./examples";
import { sourceView } from "./source-view";
import type { SourceView } from "./source-view";
import { codeGraphOf } from "./world-from-code";

/** Parses files or fails the test with the parser's message. */
const parsedFiles = (files: readonly SourceFile[]) => {
  const result = codeGraphOf(files);
  if (result.error !== null) {
    throw new Error(`${files[0]?.path}: ${result.error}`);
  }
  return result;
};

/** Parses an example or fails the test with the parser's message. */
const parsed = (name: "demo" | "loops" | "portals" | "resolution") =>
  parsedFiles(examples[name]);

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
    for (const name of Object.keys(examples) as readonly BundledName[]) {
      const result = codeGraphOf(examples[name]);
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

describe("sourceView calls", () => {
  const demo = parsed("demo");

  it("lists a function's callers and callees", () => {
    expect(
      sourceView(demo.codeGraph, demo.sources, "demo.ts::getUser")
    ).toMatchObject({ callers: ["main()"], callees: ["loadSession()"] });
  });

  it("lists the function's calls in a room of its flow too", () => {
    const fork = topLevel(demo.codeGraph, "demo.ts::main", "branch");
    expect(sourceView(demo.codeGraph, demo.sources, fork.id)).toMatchObject({
      callers: [],
      callees: ["getUser()", "showDashboard()", "showLogin()"],
    });
  });

  it("lists nothing for a hub", () => {
    expect(sourceView(demo.codeGraph, demo.sources, "demo.ts")).toMatchObject({
      callers: [],
      callees: [],
    });
  });

  it("marks a function calling itself", () => {
    const portals = parsed("portals");
    expect(
      sourceView(portals.codeGraph, portals.sources, "portals.ts::countdown")
    ).toMatchObject({
      callers: ["countdown() ↻", "main()"],
      callees: ["countdown() ↻"],
    });
  });

  it("names an ambiguous call's candidates as maybe", () => {
    const resolution = parsed("resolution");
    expect(
      sourceView(
        resolution.codeGraph,
        resolution.sources,
        "resolution.ts::main"
      )?.callees
    ).toEqual([
      "pick()",
      "settle()",
      "maybe Circle.render() | Square.render()",
    ]);
  });

  it("names the file of callers that share a name", () => {
    const caller = {
      source: 'import { run } from "./lib";\nexport function main() { run(); }',
    };
    const shared = parsedFiles([
      { path: "a.ts", ...caller },
      { path: "b.ts", ...caller },
      { path: "lib.ts", source: "export function run() {}" },
    ]);
    expect(
      sourceView(shared.codeGraph, shared.sources, "lib.ts::run")?.callers
    ).toEqual(["a.ts · main()", "b.ts · main()"]);
  });

  it("keeps five candidates of an ambiguous call and counts the rest", () => {
    const shapes = ["A", "B", "C", "D", "E", "F", "G"];
    const many = parsedFiles([
      {
        path: "many.ts",
        source: [
          ...shapes.map((shape) => `class ${shape} {\n  render() {}\n}`),
          `function main(shape: ${shapes.join(" | ")}) {\n  shape.render();\n}`,
        ].join("\n"),
      },
    ]);
    expect(
      sourceView(many.codeGraph, many.sources, "many.ts::main")?.callees
    ).toEqual([
      "maybe A.render() | B.render() | C.render() | D.render() | E.render() | +2",
    ]);
  });

  it("keeps five names and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const fan = parsedFiles([
      {
        path: "fan.ts",
        source: [
          `function main() {\n${names.map((name) => `  ${name}();`).join("\n")}\n}`,
          ...names.map((name) => `function ${name}() {}`),
        ].join("\n"),
      },
    ]);
    expect(
      sourceView(fan.codeGraph, fan.sources, "fan.ts::main")?.callees
    ).toEqual(["a()", "b()", "c()", "d()", "e()", "+2"]);
  });
});
