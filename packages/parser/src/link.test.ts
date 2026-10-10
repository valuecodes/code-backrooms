import type { CallSite, CodeGraph } from "@repo/code-graph";
import { describe, expect, it } from "vitest";

import { buildCodeGraph, parseModule } from "./parser";
import type { SourceFile } from "./parser";

/** Files as `path: source` pairs. */
const graphOf = (files: Readonly<Record<string, string>>): CodeGraph =>
  buildCodeGraph(
    Object.entries(files).map(([path, source]): SourceFile => ({
      path,
      source,
    }))
  );

/** The one call site whose callee reads `calleeName`. */
const siteOf = (graph: CodeGraph, calleeName: string): CallSite => {
  const sites = graph.callSites.filter(
    (site) => site.calleeName === calleeName
  );
  const [site] = sites;
  if (site === undefined || sites.length > 1) {
    throw new Error(`not exactly one call to ${calleeName}`);
  }
  return site;
};

const callEdges = (graph: CodeGraph) =>
  graph.edges.flatMap((edge) =>
    edge.type === "call" ? [`${edge.source}->${edge.target}`] : []
  );

const two = "export function two() {}";

describe("linkModules", () => {
  it("resolves a named import to the exported function with a call edge", () => {
    const graph = graphOf({
      "a.ts": 'import { two } from "./b";\nfunction one() { two(); }',
      "b.ts": two,
    });
    const site = siteOf(graph, "two");
    expect(site).toMatchObject({
      resolution: "resolved",
      calleeId: "b.ts::two",
      via: { localName: "two", member: null, isNew: false },
    });
    expect(callEdges(graph)).toEqual(["a.ts::one->b.ts::two"]);
    expect(graph.modules[0]?.imports[0]?.moduleId).toBe("b.ts");
  });

  it("follows aliases, defaults and namespaces", () => {
    const graph = graphOf({
      "a.ts": [
        'import { two as deux } from "./b";',
        'import run from "./c";',
        'import anon from "./d";',
        'import * as ns from "./b";',
        "function one() { deux(); run(); anon(); ns.two(); }",
      ].join("\n"),
      "b.ts": two,
      "c.ts": "export default function run() {}",
      "d.ts": "export default () => {};",
    });
    expect(siteOf(graph, "deux").calleeId).toBe("b.ts::two");
    expect(siteOf(graph, "run").calleeId).toBe("c.ts::run");
    expect(siteOf(graph, "anon").calleeId).toBe("d.ts::default");
    expect(siteOf(graph, "ns.two").calleeId).toBe("b.ts::two");
  });

  it("follows named re-exports, stars two deep and barrels of imports", () => {
    const graph = graphOf({
      "a.ts": [
        'import { deux, three, f } from "./barrel";',
        "function one() { deux(); three(); f(); }",
      ].join("\n"),
      "barrel.ts": [
        'export { two as deux } from "./b";',
        'export * from "./mid";',
        'import { f } from "./e";',
        "export { f };",
      ].join("\n"),
      "mid.ts": 'export * from "./c";',
      "b.ts": two,
      "c.ts": "export function three() {}",
      "e.ts": "export function f() {}",
    });
    expect(siteOf(graph, "deux").calleeId).toBe("b.ts::two");
    expect(siteOf(graph, "three").calleeId).toBe("c.ts::three");
    expect(siteOf(graph, "f").calleeId).toBe("e.ts::f");
  });

  it("follows `export * as ns` through a named import", () => {
    const graph = graphOf({
      "a.ts": 'import { ns } from "./barrel";\nfunction one() { ns.two(); }',
      "barrel.ts": 'export * as ns from "./b";',
      "b.ts": two,
    });
    expect(siteOf(graph, "ns.two").calleeId).toBe("b.ts::two");
  });

  it("marks a name two stars export as ambiguous, without an edge", () => {
    const graph = graphOf({
      "a.ts": 'import { two } from "./barrel";\nfunction one() { two(); }',
      "barrel.ts": 'export * from "./b";\nexport * from "./c";',
      "b.ts": two,
      "c.ts": two,
    });
    expect(siteOf(graph, "two")).toMatchObject({
      resolution: "ambiguous",
      calleeId: null,
      candidateIds: ["b.ts::two", "c.ts::two"],
    });
    expect(callEdges(graph)).toEqual([]);
  });

  it("lets a named export win over a star", () => {
    const graph = graphOf({
      "a.ts": 'import { two } from "./barrel";\nfunction one() { two(); }',
      "barrel.ts": 'export * from "./b";\nexport { two } from "./c";',
      "b.ts": two,
      "c.ts": two,
    });
    expect(siteOf(graph, "two").calleeId).toBe("c.ts::two");
  });

  it("leaves a re-export cycle unresolved without throwing", () => {
    const graph = graphOf({
      "a.ts": 'import { x } from "./b";\nfunction one() { x(); }',
      "b.ts": 'export * from "./c";',
      "c.ts": 'export * from "./b";',
    });
    expect(siteOf(graph, "x").resolution).toBe("unresolved");
  });

  it("resolves TS-style, parent and index specifiers", () => {
    const graph = graphOf({
      "src/a/x.ts": [
        'import { two } from "../b.js";',
        'import { three } from "../c";',
        "function one() { two(); three(); }",
      ].join("\n"),
      "src/b.ts": two,
      "src/c/index.ts": "export function three() {}",
    });
    expect(siteOf(graph, "two").calleeId).toBe("src/b.ts::two");
    expect(siteOf(graph, "three").calleeId).toBe("src/c/index.ts::three");
  });

  it("leaves packages and missing files unresolved, keeping via", () => {
    const graph = graphOf({
      "a.ts": [
        'import { debounce } from "lodash";',
        'import { gone } from "./missing";',
        "function one() { debounce(); gone(); }",
      ].join("\n"),
    });
    expect(siteOf(graph, "debounce")).toMatchObject({
      resolution: "unresolved",
      via: { localName: "debounce" },
    });
    expect(siteOf(graph, "gone").resolution).toBe("unresolved");
    expect(graph.modules[0]?.imports.map((record) => record.moduleId)).toEqual([
      null,
      null,
    ]);
  });

  it("resolves constructors and static methods of imported classes", () => {
    const graph = graphOf({
      "a.ts": [
        'import { Session } from "./s";',
        'import * as ns from "./s";',
        "function one() {",
        "  const session = new Session();",
        "  Session.open();",
        "  new ns.Session();",
        "  session.refresh();",
        "}",
      ].join("\n"),
      "s.ts": [
        "export class Session {",
        "  constructor() {}",
        "  static open() {}",
        "  refresh() {}",
        "}",
      ].join("\n"),
    });
    const ctor = graph.functions.find((fn) => fn.kind === "constructor")?.id;
    expect(siteOf(graph, "Session").calleeId).toBe(ctor);
    expect(siteOf(graph, "Session.open").calleeId).toBe("s.ts::Session.open");
    expect(siteOf(graph, "ns.Session").calleeId).toBe(ctor);
    expect(siteOf(graph, "session.refresh").resolution).not.toBe("resolved");
  });

  it("leaves an imported non-function unresolved", () => {
    const graph = graphOf({
      "a.ts": 'import { value } from "./b";\nfunction one() { value(); }',
      "b.ts": "export const value = 1;",
    });
    expect(siteOf(graph, "value").resolution).toBe("unresolved");
  });

  it("resolves a top-level call without adding an edge", () => {
    const graph = graphOf({
      "a.ts": 'import { two } from "./b";\ntwo();',
      "b.ts": two,
    });
    expect(siteOf(graph, "two").calleeId).toBe("b.ts::two");
    expect(callEdges(graph)).toEqual([]);
  });

  it("does not depend on the order the files come in", () => {
    const a = { path: "a.ts", source: 'import { two } from "./b";\ntwo();' };
    const b = { path: "b.ts", source: two };
    expect(buildCodeGraph([b, a])).toEqual(buildCodeGraph([a, b]));
  });

  it("leaves a single file's calls as parseModule always had them", () => {
    const parsed = parseModule({
      path: "a.ts",
      source: 'import { two } from "./b";\nfunction one() { two(); }',
    });
    expect(parsed.callSites[0]?.resolution).toBe("unresolved");
    expect(parsed.module.imports[0]?.moduleId).toBeNull();
  });
});
