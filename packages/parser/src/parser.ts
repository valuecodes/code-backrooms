import type {
  CallSite,
  CodeGraph,
  FunctionNode,
  GraphEdge,
  ModuleNode,
} from "@repo/code-graph";
import { moduleId } from "@repo/code-graph/ids";
import { hashString } from "@repo/world-generator/random";

import { languageOf, parseSource } from "./babel";
import { collectCalls } from "./calls";
import { buildFlow } from "./flow";
import { discover } from "./functions";
import type { Discovered } from "./functions";
import { exportedLocalNames, exportsOf, importsOf } from "./imports";
import { linkModules } from "./link";
import type { DiscoveredFunction } from "./scope";
import { lineCountOf } from "./span";
import { topLevelOf } from "./top-level";
import type { TopLevel } from "./top-level";

type SourceFile = {
  readonly path: string;
  readonly source: string;
};

type ParsedModule = {
  readonly module: ModuleNode;
  readonly functions: readonly FunctionNode[];
  readonly callSites: readonly CallSite[];
  readonly edges: readonly GraphEdge[];
};

/** Any analysis failure names the file, like a syntax error does. */
const withPath = <T>(path: string, run: () => T): T => {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`, { cause: error });
  }
};

/** Call sites grouped by the function (or module) they belong to. */
const sitesByCaller = (
  sites: readonly CallSite[]
): ReadonlyMap<string, readonly CallSite[]> => {
  const groups = new Map<string, CallSite[]>();
  for (const site of sites) {
    const group = groups.get(site.callerId);
    if (group === undefined) {
      groups.set(site.callerId, [site]);
    } else {
      group.push(site);
    }
  }
  return groups;
};

/**
 * One file before linking: its functions without flow (flow counts resolved
 * calls, and linking resolves more), with what the flow pass needs later.
 */
type Analysed = {
  readonly module: ModuleNode;
  readonly functions: readonly DiscoveredFunction[];
  readonly topLevel: TopLevel;
  readonly callSites: readonly CallSite[];
  readonly edges: readonly GraphEdge[];
  readonly discovered: Discovered;
  readonly source: string;
};

const analyseModule = (file: SourceFile): Analysed => {
  const id = moduleId(file.path);
  const ast = parseSource(file.path, file.source);
  const { imports, exports, discovered, calls } = withPath(file.path, () => {
    const importRecords = importsOf(ast.program);
    const exportRecords = exportsOf(ast.program);
    const found = discover(
      id,
      ast.program,
      importRecords,
      exportedLocalNames(exportRecords)
    );
    return {
      imports: importRecords,
      exports: exportRecords,
      discovered: found,
      calls: collectCalls(id, ast.program, found),
    };
  });
  return {
    module: {
      id,
      path: id,
      language: languageOf(file.path),
      lineCount: lineCountOf(file.source),
      imports,
      exports,
    },
    // nodeOf is filled as functions are registered.
    functions: [...discovered.nodeOf.keys()],
    topLevel: topLevelOf(ast.program, discovered.byNode),
    callSites: calls.callSites,
    edges: [...discovered.edges, ...calls.edges],
    discovered,
    source: file.source,
  };
};

/** Builds each function's flow from its (linked) call sites. */
const finishModule = (analysed: Analysed): ParsedModule => {
  const { module, discovered, source } = analysed;
  const byCaller = sitesByCaller(analysed.callSites);
  const functions = withPath(module.path, () =>
    analysed.functions.map((fn): FunctionNode => {
      const node = discovered.nodeOf.get(fn);
      if (node === undefined) {
        throw new Error(`No syntax node for ${fn.id}`);
      }
      return {
        ...fn,
        flow: buildFlow({
          functionId: fn.id,
          node,
          source,
          sites: byCaller.get(fn.id) ?? [],
          byNode: discovered.byNode,
        }),
      };
    })
  );
  return {
    module,
    functions: functions.sort((a, b) => a.span.start - b.span.start),
    callSites: analysed.callSites,
    edges: analysed.edges,
  };
};

/**
 * One file to its part of the graph. Deterministic: functions and call sites
 * come out in source order, ids depend only on the path and the names. Its
 * imports link only to itself (`import { f } from "./self"`).
 */
const parseModule = (file: SourceFile): ParsedModule => {
  const [linked] = linkModules([analyseModule(file)]);
  if (linked === undefined) {
    throw new Error(`${file.path}: nothing to link`);
  }
  return finishModule(linked);
};

/** Paths in code-unit order of their module ids: no locale involved. */
const byPath = (files: readonly SourceFile[]): readonly SourceFile[] =>
  files
    .map((file) => ({ file, id: moduleId(file.path) }))
    .toSorted((a, b) => {
      if (a.id === b.id) {
        return 0;
      }
      return a.id < b.id ? -1 : 1;
    })
    .map(({ file }) => file);

/**
 * Files sorted by path, so neither ids nor order depend on how they were
 * found; calls through relative imports are linked across them.
 */
const buildCodeGraph = (files: readonly SourceFile[]): CodeGraph => {
  const analysed = byPath(files).map(analyseModule);
  const seen = new Set<string>();
  for (const { module } of analysed) {
    if (seen.has(module.id)) {
      throw new Error(`Duplicate module path "${module.id}"`);
    }
    seen.add(module.id);
  }
  const parsed = linkModules(analysed).map(finishModule);
  return {
    modules: parsed.map((item) => item.module),
    functions: parsed.flatMap((item) => item.functions),
    callSites: parsed.flatMap((item) => item.callSites),
    edges: parsed.flatMap((item) => item.edges),
  };
};

/** Seeds stay within what a `?seed` URL can carry (2^31 - 1). */
const SEED_RANGE = 2 ** 31;

/**
 * A world seed from the files themselves: the same source always gives the
 * same world, and any change to a path or its text gives another one. The
 * order the files come in does not matter.
 */
const hashSource = (files: readonly SourceFile[]): number =>
  hashString(
    byPath(files)
      .map((file) => `${file.path}\0${file.source}\0`)
      .join("")
  ) % SEED_RANGE;

export { buildCodeGraph, hashSource, parseModule };
export type { ParsedModule, SourceFile };
