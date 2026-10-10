// The repository entrance: the area the player starts in, one hall (a hub
// chain when there are many) with a module portal to every entry module.

import type { Connection, GraphRoom, Portal, WorldGraph } from "@repo/types";

import type { CodeGraph, ModuleNode } from "./code-graph";
import { ENTRANCE_ID, modulePortalId } from "./ids";
import { hubDimensions } from "./room-size";
import { linksOn, MODULE_PORTALS_PER_HUB } from "./world-graph";

/**
 * The repository's name: the directory every module lies in (`src` for
 * `src/a.ts` and `src/b/c.ts`, `src/b` when all are under it), or
 * `repository` when they share none.
 */
const repositoryName = (graph: CodeGraph): string => {
  const directories = graph.modules.map((module) =>
    module.id.split("/").slice(0, -1)
  );
  const [first = [], ...rest] = directories;
  let shared = 0;
  while (
    shared < first.length &&
    rest.every((segments) => segments[shared] === first[shared])
  ) {
    shared += 1;
  }
  return shared === 0 ? "repository" : first.slice(0, shared).join("/");
};

/** The id of the entrance hub at `index`: `//entrance`, `//entrance#2`, ... */
const entranceHubId = (index: number): string =>
  index === 0 ? ENTRANCE_ID : `${ENTRANCE_ID}#${index + 1}`;

/**
 * The entrance as a world graph: a hub labelled with the repository's name
 * holding a module portal to each of `entries`, in order,
 * MODULE_PORTALS_PER_HUB to a hub, further hubs chained on by plain
 * connections when there are more. Starts at the first hub; every portal
 * leads into another area.
 */
const entranceGraph = (
  graph: CodeGraph,
  entries: readonly ModuleNode[]
): WorldGraph => {
  const count = Math.max(1, Math.ceil(entries.length / MODULE_PORTALS_PER_HUB));
  const label = repositoryName(graph);
  const rooms = Array.from({ length: count }, (_, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < count - 1 ? 1 : 0);
    return {
      id: entranceHubId(index),
      label,
      hub: true,
      ...hubDimensions(chain + linksOn(index, entries.length)),
    };
  });
  const connections = rooms.slice(1).map((room, index): Connection => ({
    from: entranceHubId(index),
    to: room.id,
  }));
  const portals = entries.map((module, index): Portal => {
    const from = entranceHubId(Math.floor(index / MODULE_PORTALS_PER_HUB));
    return {
      id: modulePortalId(from, module.id),
      kind: "module",
      from,
      to: module.id,
      label: module.path,
    };
  });
  return {
    rooms,
    connections,
    portals,
    start: ENTRANCE_ID,
    external: entries.map((module) => module.id).toSorted(),
  };
};

export { entranceGraph, repositoryName };
