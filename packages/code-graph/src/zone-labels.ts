// What a portal out of a module says: plain names within its zone, the
// package's name in front of anything in another one.

import type { CodeGraph, ModuleNode } from "./code-graph";
import { functionModuleId } from "./ids";
import { relativeToPackage } from "./packages";
import { zoneOfModule } from "./zones";
import type { Zone } from "./zones";

type ZoneLabels = {
  /** A module portal's label: the path, or `@repo/x · src/a.ts`. */
  readonly moduleLabel: (moduleId: string) => string;
  /** A call portal's label: the name, or `@repo/x · load`. */
  readonly calleeLabel: (functionId: string) => string;
};

/**
 * Labels for the portals of `from`: a module or function in the same zone
 * as `from` is named as it always was; one in another zone gets that
 * zone's name in front, and a module's path relative to its package. A
 * graph of one zone therefore labels exactly as one without packages.
 */
const zoneLabels = (graph: CodeGraph, from: ModuleNode): ZoneLabels => {
  const home = zoneOfModule(graph, from.id);
  const away = (moduleId: string): Zone | null => {
    const zone = zoneOfModule(graph, moduleId);
    return zone === null || zone === home ? null : zone;
  };
  return {
    moduleLabel: (moduleId) => {
      const path =
        graph.modules.find((candidate) => candidate.id === moduleId)?.path ??
        moduleId;
      const zone = away(moduleId);
      if (zone === null) {
        return path;
      }
      const inside =
        zone.pkg === null ? path : relativeToPackage(zone.pkg, path);
      return `${zone.name} · ${inside}`;
    },
    calleeLabel: (functionId) => {
      const name =
        graph.functions.find((fn) => fn.id === functionId)?.name ?? functionId;
      const zone = away(functionModuleId(functionId));
      return zone === null ? name : `${zone.name} · ${name}`;
    },
  };
};

export { zoneLabels };
