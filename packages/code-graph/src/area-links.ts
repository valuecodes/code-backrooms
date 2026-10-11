// The links between a code world's areas, known before any is generated:
// what a whole-repository map draws between areas that may still be pending.

import type { WorldGraph } from "@repo/types";

import type { CodeGraph } from "./code-graph";
import { entranceGraph } from "./entrance";
import { entryModules } from "./entrypoints";
import { moduleLinks } from "./module-links";
import { zoneEntranceGraph, zoneGraph } from "./zone-graph";
import { hasZones, zonesOf } from "./zones";

/**
 * Areas joined by module portals (`module`: the entrance, a zone's hub or
 * an import) or by calls (`call`), `count` of them, one link per pair and
 * kind.
 */
type AreaLink = {
  readonly fromArea: string;
  readonly toArea: string;
  readonly kind: "module" | "call";
  readonly count: number;
};

/**
 * The module portals of a hub chain's area: every portal leaves the area
 * the chain starts (`start`), whichever hub of the chain holds it.
 */
const hubLinks = (graph: WorldGraph): readonly AreaLink[] =>
  (graph.portals ?? []).map((portal) => ({
    fromArea: graph.start ?? portal.from,
    toArea: portal.to,
    kind: "module",
    count: 1,
  }));

/**
 * The hub areas' links, from the same graphs the code world builds: the
 * entrance to each zone's hub and each hub to its zone's entry modules, or
 * the entrance straight to the entry modules when nothing is zoned.
 */
const hubAreaLinks = (graph: CodeGraph): readonly AreaLink[] => {
  if (!hasZones(graph)) {
    return hubLinks(entranceGraph(graph, entryModules(graph)));
  }
  const zones = zonesOf(graph);
  return [
    ...hubLinks(zoneEntranceGraph(graph, zones)),
    ...zones.flatMap((zone) => hubLinks(zoneGraph(graph, zone))),
  ];
};

/**
 * Calls from each module into other modules: call edges by the module of
 * their caller (a function, or the module itself for top-level calls) and
 * of their callee, counted per pair, callees in the order first called.
 */
const callLinks = (
  graph: CodeGraph
): ReadonlyMap<string, readonly AreaLink[]> => {
  const moduleOf = new Map<string, string>([
    ...graph.modules.map((module): [string, string] => [module.id, module.id]),
    ...graph.functions.map((fn): [string, string] => [fn.id, fn.moduleId]),
  ]);
  const counts = new Map<string, Map<string, number>>();
  for (const site of graph.callSites) {
    if (site.calleeId === null) {
      continue;
    }
    const from = moduleOf.get(site.callerId);
    const to = moduleOf.get(site.calleeId);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    const targets = counts.get(from) ?? new Map<string, number>();
    targets.set(to, (targets.get(to) ?? 0) + 1);
    counts.set(from, targets);
  }
  return new Map(
    [...counts].map(([from, targets]) => [
      from,
      [...targets].map(([to, count]): AreaLink => ({
        fromArea: from,
        toArea: to,
        kind: "call",
        count,
      })),
    ])
  );
};

/** One list of links per graph, so a map redrawn with it does not redo it. */
const known = new WeakMap<CodeGraph, readonly AreaLink[]>();

/**
 * Every link between the code world's areas, pending ones too: the hub
 * areas' module portals first, then for each module in order the modules
 * it imports or re-exports from (`moduleLinks`), then the modules it calls
 * into with how many call sites. Never a link from an area to itself.
 */
const areaLinksOf = (graph: CodeGraph): readonly AreaLink[] => {
  const found = known.get(graph);
  if (found !== undefined) {
    return found;
  }
  const calls = callLinks(graph);
  const links = [
    ...hubAreaLinks(graph),
    ...graph.modules.flatMap((module) => [
      ...moduleLinks(graph, module).map((to): AreaLink => ({
        fromArea: module.id,
        toArea: to,
        kind: "module",
        count: 1,
      })),
      ...(calls.get(module.id) ?? []),
    ]),
  ];
  known.set(graph, links);
  return links;
};

export { areaLinksOf };
export type { AreaLink };
