// What a portal out of a module says: plain names within its zone, the
// package's name in front of anything in another one.

import type { CodeGraph, ModuleNode } from "./code-graph";
import { functionModuleId } from "./ids";
import { relativeToPackage } from "./packages";
import { hasZones, zoneOfModule } from "./zones";
import type { Zone } from "./zones";

type ZoneLabels = {
  /** A module portal's label: the path, or `@repo/x · src/a.ts`. */
  readonly moduleLabel: (moduleId: string) => string;
  /** A call portal's label: the name, or `@repo/x · load`. */
  readonly calleeLabel: (functionId: string) => string;
};

/**
 * The zone of `toModuleId` when it is not the zone of `fromModuleId`; null
 * within one zone and for ids not from this graph.
 */
const awayZone = (
  graph: CodeGraph,
  fromModuleId: string,
  toModuleId: string
): Zone | null => {
  const home = zoneOfModule(graph, fromModuleId);
  const zone = zoneOfModule(graph, toModuleId);
  return home === null || zone === null || zone === home ? null : zone;
};

/** `@repo/x · src/a.ts`: the zone's name, then the path inside its package. */
const inZone = (zone: Zone, path: string): string =>
  `${zone.name} · ${zone.pkg === null ? path : relativeToPackage(zone.pkg, path)}`;

/**
 * A module's path for the HUD: as it is in a graph of one zone or none,
 * otherwise inside its zone (`web · src/main.ts`).
 */
const zonedPath = (graph: CodeGraph, module: ModuleNode): string => {
  const zone = hasZones(graph) ? zoneOfModule(graph, module.id) : null;
  return zone === null ? module.path : inZone(zone, module.path);
};

/**
 * Labels for the portals of `from`: a module or function in the same zone
 * as `from` is named as it always was; one in another zone gets that
 * zone's name in front, and a module's path relative to its package. A
 * graph of one zone therefore labels exactly as one without packages.
 */
const zoneLabels = (graph: CodeGraph, from: ModuleNode): ZoneLabels => ({
  moduleLabel: (moduleId) => {
    const path =
      graph.modules.find((candidate) => candidate.id === moduleId)?.path ??
      moduleId;
    const zone = awayZone(graph, from.id, moduleId);
    return zone === null ? path : inZone(zone, path);
  },
  calleeLabel: (functionId) => {
    const name =
      graph.functions.find((fn) => fn.id === functionId)?.name ?? functionId;
    const zone = awayZone(graph, from.id, functionModuleId(functionId));
    return zone === null ? name : `${zone.name} · ${name}`;
  },
});

export { awayZone, zoneLabels, zonedPath };
