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

/**
 * One file to its part of the graph. Deterministic: functions and call sites
 * come out in source order, ids depend only on the path and the names.
 */
const parseModule = (file: SourceFile): ParsedModule => {
  const id = moduleId(file.path);
  const ast = parseSource(file.path, file.source);
  const discovered = discover(id, ast.program);
  const calls = collectCalls(id, ast.program, discovered);
  const module: ModuleNode = {
    id,
    path: id,
    language: languageOf(file.path),
    lineCount: lineCountOf(file.source),
  };
  return {
    module,
    functions: [...discovered.functions].sort(
      (a, b) => a.span.start - b.span.start
    ),
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
