import type {
  CallSite,
  CodeGraph,
  FunctionNode,
  GraphEdge,
  ModuleNode,
} from "@repo/code-graph";
import { moduleId } from "@repo/code-graph/ids";

import { languageOf, parseSource } from "./babel";
import { collectCalls } from "./calls";
import { buildFlow } from "./flow";
import { discover } from "./functions";
import { lineCountOf } from "./span";

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
 * One file to its part of the graph. Deterministic: functions and call sites
 * come out in source order, ids depend only on the path and the names.
 */
const parseModule = (file: SourceFile): ParsedModule => {
  const id = moduleId(file.path);
  const ast = parseSource(file.path, file.source);
  const { discovered, calls, functions } = withPath(file.path, () => {
    const found = discover(id, ast.program);
    const collected = collectCalls(id, ast.program, found);
    const byCaller = sitesByCaller(collected.callSites);
    return {
      discovered: found,
      calls: collected,
      // nodeOf is filled as functions are registered: same order as `functions`.
      functions: [...found.nodeOf].map(([fn, node]): FunctionNode => ({
        ...fn,
        flow: buildFlow({
          functionId: fn.id,
          node,
          source: file.source,
          sites: byCaller.get(fn.id) ?? [],
          byNode: found.byNode,
        }),
      })),
    };
  });
  const module: ModuleNode = {
    id,
    path: id,
    language: languageOf(file.path),
    lineCount: lineCountOf(file.source),
  };
  return {
    module,
    functions: functions.sort((a, b) => a.span.start - b.span.start),
    callSites: calls.callSites,
    edges: [...discovered.edges, ...calls.edges],
  };
};

/** Files in the given order; calls are resolved within each file only. */
const buildCodeGraph = (files: readonly SourceFile[]): CodeGraph => {
  const parsed = files.map(parseModule);
  const seen = new Set<string>();
  for (const { module } of parsed) {
    if (seen.has(module.id)) {
      throw new Error(`Duplicate module path "${module.id}"`);
    }
    seen.add(module.id);
  }
  return {
    modules: parsed.map((item) => item.module),
    functions: parsed.flatMap((item) => item.functions),
    callSites: parsed.flatMap((item) => item.callSites),
    edges: parsed.flatMap((item) => item.edges),
  };
};

export { buildCodeGraph, parseModule };
export type { ParsedModule, SourceFile };
