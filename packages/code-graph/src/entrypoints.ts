// Where a repository starts: the modules the entrance leads to.

import type { CodeGraph, ModuleNode } from "./code-graph";
import { functionModuleId } from "./ids";
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
 * nobody calls (at most 3), -1 per directory below a leading `src/`, the
 * path taken from `root` (a package's directory; `""` for the repository).
 */
const entryScore = (
  module: ModuleNode,
  graph: CodeGraph,
  called: ReadonlySet<string>,
  root: string
): number => {
  const path =
    root !== "" && module.id.startsWith(`${root}/`)
      ? module.id.slice(root.length + 1)
      : module.id;
  const segments = path.split("/");
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

/** Code-unit order of module ids, as the parser sorts files: no locale. */
const byPath = (a: ModuleNode, b: ModuleNode): number => {
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
};

/**
 * The modules the entrance leads to, best first, among `modules` (all of
 * the graph's by default; a zone's for its hub), counting only imports and
 * calls between those. Every module nobody imports is one (nothing else
 * leads there), ranked by `entryScore` with paths taken from `root` (the
 * zone's package directory), ties by path. Modules only cycles reach then
 * add the best of what is still out of reach, one at a time, until imports
 * from the entries reach every module. Never empty for a non-empty
 * `modules`.
 */
const entryModules = (
  graph: CodeGraph,
  modules: readonly ModuleNode[] = graph.modules,
  root = ""
): readonly ModuleNode[] => {
  const inside = new Set(modules.map((module) => module.id));
  const links = new Map(
    modules.map((module) => [
      module.id,
      moduleLinks(graph, module).filter((id) => inside.has(id)),
    ])
  );
  const imported = new Set([...links.values()].flat());
  const called = new Set(
    graph.edges.flatMap((edge) =>
      edge.type === "call" &&
      edge.source !== edge.target &&
      inside.has(functionModuleId(edge.source))
        ? [edge.target]
        : []
    )
  );
  const scores = new Map(
    modules.map((module) => [
      module.id,
      entryScore(module, graph, called, root),
    ])
  );
  const ranked = (group: readonly ModuleNode[]): readonly ModuleNode[] =>
    group.toSorted(
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
    ...ranked(modules.filter((module) => !imported.has(module.id))),
    ...ranked(modules.filter((module) => imported.has(module.id))),
  ]) {
    if (!reached.has(module.id)) {
      entries.push(module);
      reach(module.id);
    }
  }
  return entries;
};

export { entryModules };
