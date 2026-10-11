// The hub areas of a zoned repository: an entrance leading to one hub per
// zone, and each zone's hub leading to the package's entry modules.

import type { WorldGraph } from "@repo/types";

import type { CodeGraph } from "./code-graph";
import { hubChainGraph, repositoryName } from "./entrance";
import { entryModules } from "./entrypoints";
import { ENTRANCE_ID } from "./ids";
import { relativeToPackage } from "./packages";
import type { Zone } from "./zones";

/**
 * The entrance of a zoned repository: a hub chain labelled with the
 * repository's name holding a module portal to each zone's hub, in order,
 * labelled with the package's name.
 */
const zoneEntranceGraph = (
  graph: CodeGraph,
  zones: readonly Zone[]
): WorldGraph =>
  hubChainGraph(
    ENTRANCE_ID,
    repositoryName(graph),
    zones.map((zone) => ({ id: zone.id, label: zone.name }))
  );

/**
 * A zone's hub chain, labelled with the package's name, holding a module
 * portal to each of the zone's entry modules (`entryModules` among its own
 * modules), each labelled with its path inside the package.
 */
const zoneGraph = (graph: CodeGraph, zone: Zone): WorldGraph =>
  hubChainGraph(
    zone.id,
    zone.name,
    entryModules(graph, zone.modules).map((module) => ({
      id: module.id,
      label:
        zone.pkg === null
          ? module.path
          : relativeToPackage(zone.pkg, module.path),
    }))
  );

export { zoneEntranceGraph, zoneGraph };
