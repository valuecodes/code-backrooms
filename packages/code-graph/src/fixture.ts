// Hand-built CodeGraphs for tests. This package cannot use @repo/parser (it
// would be a workspace cycle), so fixtures describe functions and calls
// directly: one line per function, calls in the order given.

import type {
  CallEdge,
  CallSite,
  ClassNode,
  CodeGraph,
  ExportRecord,
  FlowStep,
  FunctionNode,
  ImportRecord,
  ModuleNode,
  PackageNode,
  SourceSpan,
} from "./code-graph";
import { callSiteId, classId, flowNodeId, functionId } from "./ids";

type FixtureFunction = {
  readonly name: string;
  /** Lines the function spans; defaults to 3. */
  readonly lines?: number;
  /**
   * Callee names (or qualified names) in this module, in source order, or function ids
   * (`b.ts::two`) of any module of the graph. Repeats allowed.
   */
  readonly calls?: readonly string[];
  /** Whether the module exports it; defaults to false. */
  readonly exported?: boolean;
  /**
   * The top-level class it is a method of: its qualified name becomes
   * `Class.name` and the class spans its first method to its last.
   */
  readonly className?: string;
  readonly isStatic?: boolean;
};

type FixtureModule = {
  readonly path: string;
  readonly functions: readonly FixtureFunction[];
  /** Import and export records as the parser would emit them; default none. */
  readonly imports?: readonly ImportRecord[];
  readonly exports?: readonly ExportRecord[];
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

const functionsOf = (module: FixtureModule): readonly FunctionNode[] => {
  const functions: FunctionNode[] = [];
  let line = 1;
  for (const fn of module.functions) {
    const lines = fn.lines ?? 3;
    const className = fn.className ?? null;
    const qualifiedName =
      className === null ? fn.name : `${className}.${fn.name}`;
    const id = functionId(module.path, qualifiedName);
    const span = spanAt(line, lines);
    functions.push({
      id,
      moduleId: module.path,
      name: fn.name,
      qualifiedName,
      kind: className === null ? "declaration" : "method",
      span,
      exported: fn.exported ?? false,
      async: false,
      isStatic: fn.isStatic ?? false,
      parentId: null,
      className,
      flow: flowOf(id, span, line, lines, fn.calls ?? []),
    });
    line += lines + 1;
  }
  return functions;
};

/** One top-level class per class name, from its first method to its last. */
const classesOf = (
  path: string,
  functions: readonly FunctionNode[]
): readonly ClassNode[] => {
  const classes = new Map<string, ClassNode>();
  for (const fn of functions) {
    if (fn.className === null) {
      continue;
    }
    const found = classes.get(fn.className);
    classes.set(fn.className, {
      id: classId(path, fn.className),
      moduleId: path,
      name: fn.className,
      span: {
        ...(found?.span ?? fn.span),
        end: fn.span.end,
        endLine: fn.span.endLine,
        endColumn: fn.span.endColumn,
      },
      exported: false,
      topLevel: true,
    });
  }
  return [...classes.values()];
};

/** `functions`: this module's; `all`: every module's, for calls by id. */
const fixtureModule = (
  module: FixtureModule,
  functions: readonly FunctionNode[],
  all: readonly FunctionNode[]
): CodeGraph => {
  const callSites: CallSite[] = [];
  const edges = new Map<string, CallEdge>();
  module.functions.forEach((fn, index) => {
    const caller = functions[index];
    if (caller === undefined) {
      return;
    }
    (fn.calls ?? []).forEach((callee, offset) => {
      const target = callee.includes("::")
        ? all.find((candidate) => candidate.id === callee)
        : (functions.find((candidate) => candidate.qualifiedName === callee) ??
          functions.find((candidate) => candidate.name === callee));
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
    lineCount: functions.reduce(
      (sum, fn) => sum + fn.span.endLine - fn.span.startLine + 2,
      0
    ),
    imports: module.imports ?? [],
    exports: module.exports ?? [],
  };
  return {
    modules: [node],
    functions,
    classes: classesOf(module.path, functions),
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
  const functions = modules.map(functionsOf);
  const all = functions.flat();
  const graphs = modules.map((module, index) =>
    fixtureModule(module, functions[index] ?? [], all)
  );
  return {
    modules: graphs.flatMap((graph) => graph.modules),
    functions: graphs.flatMap((graph) => graph.functions),
    classes: graphs.flatMap((graph) => graph.classes),
    callSites: graphs.flatMap((graph) => graph.callSites),
    edges: graphs.flatMap((graph) => graph.edges),
  };
};

/** A linked `import { name } from "./<target>"`, as the parser records it. */
const importOf = (target: string, name = "x"): ImportRecord => ({
  localName: name,
  importedName: name,
  specifier: `./${target}`,
  moduleId: target,
  span: spanAt(1, 1),
});

/** A workspace package at `dir`, its id its name, with no exports or paths. */
const packageNode = (
  name: string,
  dir: string,
  deps: readonly string[] = []
): PackageNode => ({ id: name, name, dir, exports: [], paths: [], deps });

/** The graph with these packages, as the parser attaches manifests. */
const withPackages = (
  graph: CodeGraph,
  ...packages: readonly PackageNode[]
): CodeGraph => ({ ...graph, packages });

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

export { demoGraph, fixtureGraph, importOf, packageNode, withPackages };
