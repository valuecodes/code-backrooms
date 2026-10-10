// Where a repository starts: the modules the entrance leads to.

import type { CodeGraph, ModuleNode } from "./code-graph";
import { moduleLinks } from "./module-links";

/** Basenames that usually start a program. */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
  "index",
  "main",
  "server",
  "app",
  "cli",
]);

/** Exported functions nobody calls count up to this many. */
const MAX_API_SCORE = 3;

/**
 * How much a module looks like a way in: +3 for an entry name (`index`,
 * `main`, `server`, `app`, `cli`, any extension), +1 per exported function
 * nobody calls (at most 3), -1 per directory below a leading `src/`.
 */
const entryScore = (
  module: ModuleNode,
  graph: CodeGraph,
  called: ReadonlySet<string>
): number => {
  const segments = module.id.split("/");
  const basename = segments.at(-1) ?? "";
  const directories = segments.slice(0, -1);
  const depth =
    directories[0] === "src" ? directories.length - 1 : directories.length;
  const api = graph.functions.filter(
    (fn) =>
      fn.moduleId === module.id &&
      fn.exported &&
      fn.parentId === null &&
      !called.has(fn.id)
  ).length;
  const name = ENTRY_NAMES.has(basename.split(".")[0] ?? "") ? 3 : 0;
  return name + Math.min(api, MAX_API_SCORE) - depth;
};

const byPath = (a: ModuleNode, b: ModuleNode): number =>
  a.path.localeCompare(b.path, undefined, { numeric: true });

/**
 * The modules the entrance leads to, best first. Every module nobody
 * imports is one (nothing else leads there), ranked by `entryScore`, ties
 * by path. Modules only cycles reach then add the best of what is still
 * out of reach, one at a time, until imports from the entries reach every
 * module. Never empty for a graph with modules.
 */
const entryModules = (graph: CodeGraph): readonly ModuleNode[] => {
  const links = new Map(
    graph.modules.map((module) => [module.id, moduleLinks(graph, module)])
  );
  const imported = new Set([...links.values()].flat());
  const called = new Set(
    graph.edges.flatMap((edge) =>
      edge.type === "call" && edge.source !== edge.target ? [edge.target] : []
    )
  );
  const scores = new Map(
    graph.modules.map((module) => [
      module.id,
      entryScore(module, graph, called),
    ])
  );
  const ranked = (modules: readonly ModuleNode[]): readonly ModuleNode[] =>
    modules.toSorted(
      (a, b) =>
        (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byPath(a, b)
    );
  const reached = new Set<string>();
  const reach = (id: string) => {
    const queue = [id];
    reached.add(id);
    // for...of sees ids pushed while iterating, so this is a plain BFS.
    for (const current of queue) {
      for (const next of links.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
  };
  const entries: ModuleNode[] = [];
  for (const module of [
    ...ranked(graph.modules.filter((module) => !imported.has(module.id))),
    ...ranked(graph.modules.filter((module) => imported.has(module.id))),
  ]) {
    if (!reached.has(module.id)) {
      entries.push(module);
      reach(module.id);
    }
  }
  return entries;
};

export { entryModules };
