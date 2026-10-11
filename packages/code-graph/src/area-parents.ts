// Each code area's parent: the area it is first reached from, walking out
// of the entrance. The areas are placed beside their parents, so the world
// grows from the entrance as a tree: zones as branches, modules round the
// modules that import them.

import { areaLinksOf } from "./area-links";
import type { AreaLink } from "./area-links";
import type { CodeGraph } from "./code-graph";
import { ENTRANCE_ID } from "./ids";
import { hasZones, isZoneHub, zoneOfModule, zonesOf } from "./zones";

/** One parent map per graph. */
const known = new WeakMap<CodeGraph, ReadonlyMap<string, string>>();

/**
 * Every area but the entrance by its parent, in the order reached: a
 * breadth-first walk from the entrance over module links within a zone
 * first (the entrance's to the zone hubs included), then over any module
 * link, then over calls, each pass going on from every area reached so far.
 * An area none of them reaches hangs off its zone's hub, or the entrance.
 * A tree: every parent is reached before its children.
 */
const areaParentsOf = (graph: CodeGraph): ReadonlyMap<string, string> => {
  const found = known.get(graph);
  if (found !== undefined) {
    return found;
  }
  const zoned = hasZones(graph);
  const zoneOf = (area: string): string | null => {
    if (!zoned || area === ENTRANCE_ID) {
      return null;
    }
    return isZoneHub(area) ? area : (zoneOfModule(graph, area)?.id ?? null);
  };
  const links = areaLinksOf(graph);
  const parents = new Map<string, string>();
  const reached = [ENTRANCE_ID];
  const seen = new Set(reached);
  const walk = (allowed: (link: AreaLink) => boolean) => {
    const out = new Map<string, AreaLink[]>();
    for (const link of links.filter(allowed)) {
      out.set(link.fromArea, [...(out.get(link.fromArea) ?? []), link]);
    }
    // for...of sees areas pushed while iterating, so this is a plain BFS.
    for (const from of reached) {
      for (const { toArea } of out.get(from) ?? []) {
        if (!seen.has(toArea)) {
          seen.add(toArea);
          reached.push(toArea);
          parents.set(toArea, from);
        }
      }
    }
  };
  walk(
    (link) =>
      link.kind === "module" &&
      (link.fromArea === ENTRANCE_ID ||
        zoneOf(link.fromArea) === zoneOf(link.toArea))
  );
  walk((link) => link.kind === "module");
  walk((link) => link.kind === "call");
  const areas = [
    ...(zoned ? zonesOf(graph).map((zone) => zone.id) : []),
    ...graph.modules.map((module) => module.id),
  ];
  for (const area of areas) {
    if (!seen.has(area)) {
      const hub = zoneOf(area);
      parents.set(area, hub !== null && seen.has(hub) ? hub : ENTRANCE_ID);
    }
  }
  known.set(graph, parents);
  return parents;
};

export { areaParentsOf };
