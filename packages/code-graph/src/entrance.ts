// The repository entrance: the area the player starts in, one hall (a hub
// chain when there are many) with a module portal to every entry module.

import type { Connection, GraphRoom, Portal, WorldGraph } from "@repo/types";

import type { CodeGraph, ModuleNode } from "./code-graph";
import { linksOn, MODULE_PORTALS_PER_HUB } from "./hub-plan";
import { ENTRANCE_ID, modulePortalId } from "./ids";
import { hubDimensions } from "./room-size";

/**
 * The repository's name: the root package's (`package.json` at the top)
 * when there is one, otherwise the directory every module lies in (`src`
 * for `src/a.ts` and `src/b/c.ts`, `src/b` when all are under it), or
 * `repository` when they share none.
 */
const repositoryName = (graph: CodeGraph): string => {
  const root = graph.packages?.find((pkg) => pkg.dir === "");
  if (root !== undefined) {
    return root.name;
  }
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

/** The hub at `index` of the chain starting at `hubId`: `hubId`, `hubId#2`, ... */
const chainHubId = (hubId: string, index: number): string =>
  index === 0 ? hubId : `${hubId}#${index + 1}`;

/** Where a hub chain's module portal leads, and what it says. */
type ChainTarget = { readonly id: string; readonly label: string };

/**
 * A hub labelled `label` holding a module portal to each of `targets`, in
 * order, MODULE_PORTALS_PER_HUB to a hub, further hubs chained on by plain
 * connections when there are more. Starts at the first hub; every portal
 * leads into another area.
 */
const hubChainGraph = (
  hubId: string,
  label: string,
  targets: readonly ChainTarget[]
): WorldGraph => {
  const count = Math.max(1, Math.ceil(targets.length / MODULE_PORTALS_PER_HUB));
  const rooms = Array.from({ length: count }, (_, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < count - 1 ? 1 : 0);
    return {
      id: chainHubId(hubId, index),
      label,
      hub: true,
      ...hubDimensions(chain + linksOn(index, targets.length)),
    };
  });
  const connections = rooms.slice(1).map((room, index): Connection => ({
    from: chainHubId(hubId, index),
    to: room.id,
  }));
  const portals = targets.map((target, index): Portal => {
    const from = chainHubId(hubId, Math.floor(index / MODULE_PORTALS_PER_HUB));
    return {
      id: modulePortalId(from, target.id),
      kind: "module",
      from,
      to: target.id,
      label: target.label,
    };
  });
  return {
    rooms,
    connections,
    portals,
    start: hubId,
    external: targets.map((target) => target.id).toSorted(),
  };
};

/**
 * The entrance as a world graph: a hub chain labelled with the repository's
 * name holding a module portal to each of `entries`, in order.
 */
const entranceGraph = (
  graph: CodeGraph,
  entries: readonly ModuleNode[]
): WorldGraph =>
  hubChainGraph(
    ENTRANCE_ID,
    repositoryName(graph),
    entries.map((module) => ({ id: module.id, label: module.path }))
  );

export { entranceGraph, hubChainGraph, repositoryName };
