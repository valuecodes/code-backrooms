import type { CodeGraph, ModuleNode } from "./code-graph";
import { createResolver } from "./module-resolver";

/**
 * The files of the graph `module` imports (its linked imports) and then
 * the ones it re-exports from (`export … from`, so a barrel leads on to
 * what it gathers), each once, in source order, never itself.
 */
const moduleLinks = (
  graph: CodeGraph,
  module: ModuleNode
): readonly string[] => {
  const ids = new Set(graph.modules.map((candidate) => candidate.id));
  const resolve = createResolver(ids, graph.packages ?? []);
  const links: string[] = [];
  const reExported = module.exports.flatMap(({ specifier }) =>
    specifier === null ? [] : [resolve(module.id, specifier)]
  );
  for (const moduleId of [
    ...module.imports.map((record) => record.moduleId),
    ...reExported,
  ]) {
    if (
      moduleId !== null &&
      moduleId !== module.id &&
      ids.has(moduleId) &&
      !links.includes(moduleId)
    ) {
      links.push(moduleId);
    }
  }
  return links;
};

export { moduleLinks };
