import { describe, expect, it } from "vitest";

import type {
  CallSite,
  CodeGraph,
  FunctionNode,
  ImportRecord,
  SourceSpan,
} from "./code-graph";
import { demoGraph, fixtureGraph } from "./fixture";
import { branch, fnWith, step } from "./flow-fixture";
import { layoutFlow, planFlow } from "./flow-layout";
import { modulePortalId, parseFlowNodeId } from "./ids";
import { packageOf, portalSubject, roomSubject } from "./subjects";
import { toWorldGraph } from "./world-graph";

/** The call portal id for the first site from `caller` to `callee`. */
const callPortalId = (
  graph: ReturnType<typeof fixtureGraph>,
  caller: string,
  callee: string
): string => {
  const site = graph.callSites.find(
    (candidate) =>
      candidate.callerId === caller && candidate.calleeId === callee
  );
  return `portal:${site?.id ?? "?"}`;
};

describe("roomSubject", () => {
  const graph = demoGraph();

  it("names modules, functions and flow rooms, and nothing else", () => {
    expect(roomSubject(graph, "demo.ts")).toMatchObject({
      kind: "module",
      module: { path: "demo.ts" },
    });
    expect(roomSubject(graph, "demo.ts::getUser")).toMatchObject({
      kind: "function",
      fn: { name: "getUser" },
      module: { path: "demo.ts" },
    });
    const main = graph.functions[0];
    const [first, second] = main?.flow.steps ?? [];
    expect(roomSubject(graph, first?.id ?? "")).toMatchObject({
      kind: "flow",
      fn: { name: "main" },
      module: { path: "demo.ts" },
      node: { kind: "step" },
      ancestors: [{ kind: "sequence" }],
      text: "9 statements",
    });
    expect(roomSubject(graph, second?.id ?? "")).toMatchObject({
      kind: "flow",
      text: "getUser(…)",
    });
    expect(roomSubject(graph, "demo.ts::main@99999:step")).toBeNull();
    expect(roomSubject(graph, "demo.ts::nobody@0:step:empty")).toBeNull();
    expect(roomSubject(graph, "corridor-1")).toBeNull();
    expect(roomSubject(graph, "other.ts::getUser")).toBeNull();
  });
});

describe("portalSubject", () => {
  const graph = fixtureGraph({
    path: "m.ts",
    functions: [
      { name: "main", calls: ["shared"] },
      { name: "other", calls: ["shared"] },
      { name: "shared" },
    ],
  });

  it("names the call site and both functions of a call portal", () => {
    const portal = callPortalId(graph, "m.ts::other", "m.ts::shared");
    expect(portalSubject(graph, portal)).toMatchObject({
      kind: "call",
      site: { callerId: "m.ts::other" },
      caller: { name: "other" },
      callee: { name: "shared" },
    });
  });

  it("names the function of a return portal by its flow room", () => {
    const exit = toWorldGraph(graph).portals?.find(
      (portal) =>
        portal.kind === "return" &&
        parseFlowNodeId(portal.from)?.functionId === "m.ts::shared"
    );
    expect(portalSubject(graph, exit?.id ?? "")).toMatchObject({
      kind: "return",
      fn: { name: "shared" },
    });
    expect(portalSubject(graph, "return:m.ts::shared")).toMatchObject({
      kind: "return",
      fn: { name: "shared" },
    });
  });

  it("names the module a module portal leads to", () => {
    const linked = fixtureGraph(
      { path: "a.ts", functions: [] },
      { path: "b.ts", functions: [] }
    );
    expect(portalSubject(linked, modulePortalId("a.ts", "b.ts"))).toMatchObject(
      {
        kind: "module",
        from: { path: "a.ts" },
        module: { path: "b.ts" },
      }
    );
    expect(portalSubject(linked, modulePortalId("a.ts", "c.ts"))).toBeNull();
  });

  it("returns null for anything else", () => {
    expect(portalSubject(graph, "corridor-1")).toBeNull();
    expect(portalSubject(graph, "portal:m.ts::nobody@1")).toBeNull();
    expect(portalSubject(graph, "return:m.ts::nobody")).toBeNull();
    expect(portalSubject(graph, "return:m.ts::nobody@3:step")).toBeNull();
    expect(portalSubject(graph, "jump:m.ts::main@3:break")).toBeNull();
    expect(portalSubject(graph, "jump:hub")).toBeNull();
  });
});

describe("roomSubject folded rooms", () => {
  it("describes a room folded into budget by what it holds", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "big", calls: Array.from({ length: 40 }, () => "a") },
        { name: "a" },
      ],
    });
    const big = graph.functions[0];
    if (big === undefined) {
      throw new Error("no function");
    }
    const sites = graph.callSites.filter((site) => site.callerId === big.id);
    const folded = layoutFlow(planFlow(big, sites)).rooms.find(
      (room) => room.role === "collapsed"
    );
    expect(folded).toBeDefined();
    const subject = roomSubject(graph, folded?.id ?? "");
    expect(subject).toMatchObject({ kind: "flow", text: folded?.label });
    expect(folded?.label).toMatch(/^\d+ statements · \d+ calls$/);
  });
});

/** A one-function graph around a hand-built flow. */
const graphWith = (fn: FunctionNode): CodeGraph => ({
  modules: [
    {
      id: "m.ts",
      path: "m.ts",
      language: "typescript",
      lineCount: 1,
      imports: [],
      exports: [],
    },
  ],
  functions: [fn],
  callSites: [],
  edges: [],
});

/** Distinct spans: line n + 1 holds node n, columns 2..7. */
const spanOf = (index: number): SourceSpan => ({
  start: 100 * index + 2,
  end: 100 * index + 7,
  startLine: index + 1,
  startColumn: 2,
  endLine: index + 1,
  endColumn: 7,
});

describe("roomSubject spans", () => {
  it("gives a flow room its node's span, a tagged room its composite's", () => {
    const then = { ...step(2, 1), span: spanOf(2) };
    const fork = { ...branch(1, [then], [step(3, 1)]), span: spanOf(1) };
    const graph = graphWith(fnWith([fork]));
    expect(roomSubject(graph, then.id)).toMatchObject({ span: spanOf(2) });
    expect(roomSubject(graph, fork.id)).toMatchObject({ span: spanOf(1) });
    expect(roomSubject(graph, `${fork.id}:merge`)).toMatchObject({
      span: spanOf(1),
    });
  });

  it("spans a budget-folded room from its first node to its last", () => {
    const steps = Array.from({ length: 200 }, (_, index) => ({
      ...step(100 * index + 2, 1),
      span: spanOf(index),
    }));
    const fn = fnWith(steps);
    const [roomId, lastId] = [...planFlow(fn, []).folds][0] ?? [];
    const first = steps.findIndex((node) => node.id === roomId);
    const last = steps.findIndex((node) => node.id === lastId);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);
    expect(roomSubject(graphWith(fn), roomId ?? "")).toMatchObject({
      kind: "flow",
      span: {
        start: 100 * first + 2,
        startLine: first + 1,
        startColumn: 2,
        end: 100 * last + 7,
        endLine: last + 1,
        endColumn: 7,
      },
    });
  });
});

describe("packageOf", () => {
  const span = spanOf(0);
  const record = (
    localName: string,
    specifier: string,
    moduleId: string | null
  ): ImportRecord => ({
    localName,
    importedName: localName,
    specifier,
    moduleId,
    span,
  });
  const graph: CodeGraph = {
    ...demoGraph(),
    modules: [
      {
        id: "a.ts",
        path: "a.ts",
        language: "typescript",
        lineCount: 1,
        imports: [
          record("format", "node:util", null),
          record("gone", "./missing", null),
          record("two", "./b", "b.ts"),
        ],
        exports: [],
      },
    ],
  };
  const site = (callerId: string, localName: string | null): CallSite => ({
    id: `${callerId}@0`,
    callerId,
    calleeName: localName ?? "x",
    calleeId: null,
    resolution: "unresolved",
    kind: "call",
    awaited: false,
    span,
    ...(localName === null
      ? {}
      : { via: { localName, member: null, isNew: false } }),
  });

  it("names the package a call goes into, from a function or the module", () => {
    expect(packageOf(graph, site("a.ts::main", "format"))).toBe("node:util");
    expect(packageOf(graph, site("a.ts", "format"))).toBe("node:util");
  });

  it("is null for files, missing files and calls without an import", () => {
    expect(packageOf(graph, site("a.ts::main", "two"))).toBeNull();
    expect(packageOf(graph, site("a.ts::main", "gone"))).toBeNull();
    expect(packageOf(graph, site("a.ts::main", null))).toBeNull();
    expect(packageOf(graph, site("other.ts::main", "format"))).toBeNull();
  });
});
