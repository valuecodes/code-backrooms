// Hand-built CodeGraphs for tests. This package cannot use @repo/parser (it
// would be a workspace cycle), so fixtures describe functions and calls
// directly: one line per function, calls in the order given.

import type {
  CallEdge,
  CallSite,
  CodeGraph,
  FlowStep,
  FunctionNode,
  ModuleNode,
  SourceSpan,
} from "./code-graph";
import { callSiteId, flowNodeId, functionId } from "./ids";

type FixtureFunction = {
  readonly name: string;
  /** Lines the function spans; defaults to 3. */
  readonly lines?: number;
  /** Callee names in this module, in source order. Repeats allowed. */
  readonly calls?: readonly string[];
};

type FixtureModule = {
  readonly path: string;
  readonly functions: readonly FixtureFunction[];
};

const LINE_WIDTH = 40;

const spanAt = (startLine: number, lines: number): SourceSpan => ({
  start: (startLine - 1) * LINE_WIDTH,
  end: (startLine - 1 + lines) * LINE_WIDTH - 1,
  startLine,
  startColumn: 0,
  endLine: startLine + lines - 1,
  endColumn: 1,
});

/** The call site a fixture function's n-th call gets: one offset past the start. */
const siteOffset = (span: SourceSpan, index: number): number =>
  span.start + index + 1;

/** A flow of one step covering the lines, then one call node per callee. */
const flowOf = (
  id: string,
  span: SourceSpan,
  startLine: number,
  lines: number,
  calls: readonly string[]
): FunctionNode["flow"] => {
  const lineSpan = spanAt(startLine, 1);
  const steps: FlowStep[] = [
    {
      id: flowNodeId(id, span.start, "step"),
      kind: "step",
      span: lineSpan,
      statements: lines,
    },
    ...calls.map((_, index): FlowStep => ({
      id: flowNodeId(id, siteOffset(span, index), "call"),
      kind: "call",
      span: lineSpan,
      callSiteIds: [callSiteId(id, siteOffset(span, index))],
    })),
  ];
  return {
    id: flowNodeId(id, span.start, "sequence", "body"),
    kind: "sequence",
    span,
    steps,
  };
};

const fixtureModule = (module: FixtureModule): CodeGraph => {
  const functions: FunctionNode[] = [];
  let line = 1;
  for (const fn of module.functions) {
    const lines = fn.lines ?? 3;
    const id = functionId(module.path, fn.name);
    const span = spanAt(line, lines);
    functions.push({
      id,
      moduleId: module.path,
      name: fn.name,
      qualifiedName: fn.name,
      kind: "declaration",
      span,
      exported: false,
      async: false,
      isStatic: false,
      parentId: null,
      className: null,
      flow: flowOf(id, span, line, lines, fn.calls ?? []),
    });
    line += lines + 1;
  }
  const callSites: CallSite[] = [];
  const edges = new Map<string, CallEdge>();
  module.functions.forEach((fn, index) => {
    const caller = functions[index];
    if (caller === undefined) {
      return;
    }
    (fn.calls ?? []).forEach((callee, offset) => {
      const target = functions.find((candidate) => candidate.name === callee);
      if (target === undefined) {
        throw new Error(`Fixture calls unknown function "${callee}"`);
      }
      const site: CallSite = {
        id: callSiteId(caller.id, siteOffset(caller.span, offset)),
        callerId: caller.id,
        calleeName: callee,
        calleeId: target.id,
        resolution: "resolved",
        kind: "call",
        awaited: false,
        span: spanAt(caller.span.startLine, 1),
      };
      callSites.push(site);
      const key = `${caller.id}->${target.id}`;
      const existing = edges.get(key);
      edges.set(key, {
        type: "call",
        source: caller.id,
        target: target.id,
        callSiteIds: [...(existing?.callSiteIds ?? []), site.id],
      });
    });
  });
  const node: ModuleNode = {
    id: module.path,
    path: module.path,
    language: "typescript",
    lineCount: line - 1,
  };
  return {
    modules: [node],
    functions,
    callSites,
    edges: [
      ...functions.map((fn) => ({
        type: "containment" as const,
        source: module.path,
        target: fn.id,
      })),
      ...edges.values(),
    ],
  };
};

/** Several modules in one graph, in the order given. */
const fixtureGraph = (...modules: readonly FixtureModule[]): CodeGraph => {
  const graphs = modules.map(fixtureModule);
  return {
    modules: graphs.flatMap((graph) => graph.modules),
    functions: graphs.flatMap((graph) => graph.functions),
    callSites: graphs.flatMap((graph) => graph.callSites),
    edges: graphs.flatMap((graph) => graph.edges),
  };
};

/** The reference demo from the product plan (section 23). */
const demoGraph = (): CodeGraph =>
  fixtureGraph({
    path: "demo.ts",
    functions: [
      {
        name: "main",
        lines: 9,
        calls: ["getUser", "showDashboard", "showLogin"],
      },
      { name: "getUser", calls: ["loadSession"] },
      { name: "showDashboard", lines: 1 },
      { name: "showLogin", lines: 1 },
      { name: "loadSession", lines: 1 },
    ],
  });

export { demoGraph, fixtureGraph };
