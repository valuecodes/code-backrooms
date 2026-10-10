import type {
  ClusterPortal,
  Connection,
  GraphRoom,
  Port,
  Portal,
  RoomCluster,
  WorldGraph,
} from "@repo/types";
import { FLOW_TOP_MIN_WIDTH } from "@repo/world-generator/config";

import type {
  CallEdge,
  CallSite,
  CodeGraph,
  FunctionNode,
  ModuleNode,
} from "./code-graph";
import { layoutFlow, planFlow } from "./flow-layout";
import { modulePortalId } from "./ids";
import { moduleLinks } from "./module-links";
import { hubDimensions } from "./room-size";
import { columnJitter, hubRatio } from "./variation";

/** Functions nobody else calls, from the directed edges, in source order. */
const rootsOf = (
  graph: CodeGraph,
  functions: readonly FunctionNode[]
): readonly FunctionNode[] => {
  const called = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "call" && edge.source !== edge.target) {
      called.add(edge.target);
    }
  }
  return functions.filter((fn) => !called.has(fn.id));
};

type ModulePlan = {
  /** Functions that hang off the hub, sorted by source position. */
  readonly attached: readonly FunctionNode[];
  /** Calls realised as physical doors, in discovery order. */
  readonly tree: readonly CallEdge[];
};

/** `source->target`: the key of a call edge in `portalOnly`. */
const edgeKey = (source: string, target: string): string =>
  `${source}->${target}`;

/**
 * Which calls become doors: a breadth-first walk of the module's call graph
 * from its roots, each function entered once, through the ports its rooms
 * offer (`candidates`: the callees a function has a port for) and never
 * along an edge in `portalOnly`. The door therefore belongs to the caller
 * that first reaches a function in that walk, which is usually but not
 * always its first caller in source order. A directed walk from the roots
 * misses functions that only cycles reach (`a <-> b` called by nobody
 * else), so whatever is left over is attached to the hub in source order
 * and walked from there.
 */
const planModule = (
  graph: CodeGraph,
  functions: readonly FunctionNode[],
  candidates: ReadonlyMap<string, ReadonlySet<string>>,
  portalOnly: ReadonlySet<string>
): ModulePlan => {
  const ids = new Set(functions.map((fn) => fn.id));
  const outgoing = new Map<string, CallEdge[]>();
  for (const edge of graph.edges) {
    if (edge.type === "call" && ids.has(edge.source)) {
      const edges = outgoing.get(edge.source);
      if (edges === undefined) {
        outgoing.set(edge.source, [edge]);
      } else {
        edges.push(edge);
      }
    }
  }
  const visited = new Set<string>();
  const attached: FunctionNode[] = [];
  const tree: CallEdge[] = [];
  const walk = (seed: FunctionNode) => {
    attached.push(seed);
    visited.add(seed.id);
    const queue = [seed.id];
    // for...of sees ids pushed while iterating, so this is a plain BFS.
    for (const id of queue) {
      for (const edge of outgoing.get(id) ?? []) {
        if (
          ids.has(edge.target) &&
          !visited.has(edge.target) &&
          candidates.get(id)?.has(edge.target) === true &&
          !portalOnly.has(edgeKey(id, edge.target))
        ) {
          visited.add(edge.target);
          tree.push(edge);
          queue.push(edge.target);
        }
      }
    }
  };
  for (const fn of [...rootsOf(graph, functions), ...functions]) {
    if (!visited.has(fn.id)) {
      walk(fn);
    }
  }
  return {
    attached: attached.sort((a, b) => a.span.start - b.span.start),
    tree,
  };
};

/**
 * Doors per hub, links to other hubs included: what the layout places
 * reliably (the random generator's MAX_DEGREE). A module with more roots
 * chains further hubs (`demo.ts`, `demo.ts#2`, ...) instead of asking one
 * for walls it cannot have.
 */
const MAX_HUB_DOORS = 5;

/**
 * Module portals per hub: a hub stops growing at 20 x 20 m, about eight
 * openings of wall, so a module importing more files spreads its module
 * portals along the hub chain, chaining further hubs when it runs out.
 */
const MODULE_PORTALS_PER_HUB = 8;

/** How many of `links` module portals stand on the hub at `index`. */
const linksOn = (index: number, links: number): number =>
  Math.max(
    0,
    Math.min(MODULE_PORTALS_PER_HUB, links - index * MODULE_PORTALS_PER_HUB)
  );

/**
 * Splits the roots over hubs so that no hub exceeds MAX_HUB_DOORS once its
 * links to the previous and next hub count. Module portals are not doors,
 * so they do not count. Always at least one group, possibly empty.
 */
const hubGroups = (
  attached: readonly FunctionNode[]
): readonly (readonly FunctionNode[])[] => {
  const groups: (readonly FunctionNode[])[] = [];
  let remaining = attached;
  do {
    const links = groups.length > 0 ? 1 : 0;
    let take = Math.max(1, MAX_HUB_DOORS - links);
    if (remaining.length > take) {
      take = Math.max(1, take - 1);
    }
    groups.push(remaining.slice(0, take));
    remaining = remaining.slice(take);
  } while (remaining.length > 0);
  return groups;
};

type Realised = {
  readonly cluster: RoomCluster;
  readonly calls: readonly Portal[];
  readonly returns: readonly Portal[];
  /** `break` and `continue`, each to a room of the same cluster. */
  readonly jumps: readonly Portal[];
  /** Closed frames, each on and "to" its own room. */
  readonly markers: readonly Portal[];
};

/**
 * A function's cluster once the doors are decided: the entry port and the
 * ports of the first call to each tree callee stay ports (a single callee
 * is offered both side walls, so those come as a pair); every other
 * reserved port becomes a call portal at its centre (recursion, extra
 * callers of a shared function, a second room calling the same callee),
 * one per call site. Portals get their graph form, `from` the flow room
 * and `to` the callee, the module hub, for a jump a room of the same
 * cluster, or for a marker its own room.
 */
const realise = (
  cluster: RoomCluster,
  treeCallees: ReadonlySet<string>,
  hubId: string,
  nameOf: (id: string) => string
): Realised => {
  const kept: Port[] = [];
  const converted: ClusterPortal[] = [];
  const doorSites = new Set<string>();
  const portalSites = new Set<string>();
  const doorTo = new Set<string>();
  for (const port of cluster.ports) {
    const callee = port.reservedFor;
    const site = port.portalId;
    if (callee === undefined) {
      kept.push(port);
    } else if (site !== undefined && doorSites.has(site)) {
      kept.push(port);
    } else if (treeCallees.has(callee) && !doorTo.has(callee)) {
      doorTo.add(callee);
      kept.push(port);
      if (site !== undefined) {
        doorSites.add(site);
      }
    } else if (site !== undefined && !portalSites.has(site)) {
      portalSites.add(site);
      converted.push({
        id: site,
        kind: "call",
        roomId: port.roomId,
        wall: port.wall,
        along: (port.lo + port.hi) / 2,
        target: callee,
      });
    }
  }
  const portals = [...converted, ...cluster.portals].map(
    (portal): ClusterPortal => ({
      ...portal,
      label:
        portal.kind === "call"
          ? nameOf(portal.target ?? "")
          : (portal.label ?? portal.kind),
    })
  );
  const toPortal = (portal: ClusterPortal): Portal => ({
    id: portal.id,
    kind: portal.kind,
    from: portal.roomId,
    to: portal.kind === "marker" ? portal.roomId : (portal.target ?? hubId),
    ...(portal.label === undefined ? {} : { label: portal.label }),
  });
  return {
    cluster: { ...cluster, ports: kept, portals },
    calls: portals.filter((portal) => portal.kind === "call").map(toPortal),
    returns: portals.filter((portal) => portal.kind === "return").map(toPortal),
    jumps: portals.filter((portal) => portal.kind === "jump").map(toPortal),
    markers: portals.filter((portal) => portal.kind === "marker").map(toPortal),
  };
};

type ModuleWorld = {
  /** The module's hubs, chained in order; the first is its entrance. */
  readonly hubs: readonly GraphRoom[];
  readonly rooms: readonly GraphRoom[];
  readonly connections: readonly Connection[];
  readonly portals: readonly Portal[];
};

const sitesByCaller = (
  sites: readonly CallSite[]
): ReadonlyMap<string, readonly CallSite[]> => {
  const groups = new Map<string, CallSite[]>();
  for (const site of sites) {
    const group = groups.get(site.callerId);
    if (group === undefined) {
      groups.set(site.callerId, [site]);
    } else {
      group.push(site);
    }
  }
  return groups;
};

/**
 * `links`: module portals on the hubs, MODULE_PORTALS_PER_HUB to each from
 * the first on, which widen them but are not doors.
 */
const moduleWorld = (
  graph: CodeGraph,
  module: ModuleNode,
  links: number,
  portalOnly: ReadonlySet<string>,
  seed: number | null
): ModuleWorld => {
  const functions = graph.functions.filter((fn) => fn.moduleId === module.id);
  const sites = sitesByCaller(graph.callSites);
  // Every function is planned first: a callee's width sets how far apart
  // the ports for it must sit, and a plan depends on its own body alone.
  // The seeded jitter widens a column after folding, so rooms stay the same.
  const plans = new Map(
    functions.map((fn) => {
      const plan = planFlow(fn, sites.get(fn.id) ?? []);
      return [
        fn.id,
        { ...plan, width: plan.width + columnJitter(seed, fn.id) },
      ];
    })
  );
  const widthOf = (id: string): number =>
    plans.get(id)?.width ?? FLOW_TOP_MIN_WIDTH;
  const clusters = new Map(
    [...plans].map(([id, plan]) => [id, layoutFlow(plan, widthOf)])
  );
  const candidates = new Map(
    [...clusters].map(([id, cluster]) => [
      id,
      new Set(
        cluster.ports.flatMap((port) =>
          port.reservedFor === undefined ? [] : [port.reservedFor]
        )
      ),
    ])
  );
  const { attached, tree } = planModule(
    graph,
    functions,
    candidates,
    portalOnly
  );
  const treeCallees = new Map<string, Set<string>>();
  for (const edge of tree) {
    treeCallees.set(
      edge.source,
      new Set([...(treeCallees.get(edge.source) ?? []), edge.target])
    );
  }
  const nameOf = (id: string): string =>
    graph.functions.find((fn) => fn.id === id)?.name ?? id;
  const rooms: GraphRoom[] = [];
  const calls: Portal[] = [];
  const returns: Portal[] = [];
  const jumps: Portal[] = [];
  const markers: Portal[] = [];
  for (const fn of functions) {
    const cluster = clusters.get(fn.id);
    if (cluster === undefined) {
      continue;
    }
    const realised = realise(
      cluster,
      treeCallees.get(fn.id) ?? new Set(),
      module.id,
      nameOf
    );
    rooms.push({
      id: fn.id,
      label: fn.name,
      width: realised.cluster.width,
      depth: realised.cluster.depth,
      cluster: realised.cluster,
    });
    calls.push(...realised.calls);
    returns.push(...realised.returns);
    jumps.push(...realised.jumps);
    markers.push(...realised.markers);
  }
  const rootGroups = hubGroups(attached);
  const groups = [
    ...rootGroups,
    ...Array.from(
      {
        length: Math.max(
          0,
          Math.ceil(links / MODULE_PORTALS_PER_HUB) - rootGroups.length
        ),
      },
      (): readonly FunctionNode[] => []
    ),
  ];
  const hubs = groups.map((group, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < groups.length - 1 ? 1 : 0);
    const id = index === 0 ? module.id : `${module.id}#${index + 1}`;
    return {
      id,
      label: module.path,
      hub: true,
      ...hubDimensions(
        group.length + chain + linksOn(index, links),
        hubRatio(seed, id)
      ),
    };
  });
  const connections: Connection[] = [];
  groups.forEach((group, index) => {
    const hub = hubs[index];
    const next = hubs[index + 1];
    if (hub === undefined) {
      return;
    }
    if (next !== undefined) {
      connections.push({ from: hub.id, to: next.id });
    }
    for (const fn of group) {
      connections.push({ from: hub.id, to: fn.id });
    }
  });
  connections.push(
    ...tree.map((edge): Connection => ({
      from: edge.source,
      to: edge.target,
      kind: "call",
    }))
  );
  return {
    hubs,
    rooms,
    connections,
    portals: [...calls, ...returns, ...jumps, ...markers],
  };
};

/**
 * The spatial grammar for one module (the first by default): one cluster
 * per function (a column of flow rooms with a return portal at its end),
 * a hub that opens onto the module's roots (more hubs chained when there
 * are many), a door for each call on the breadth-first tree from those
 * roots through the rooms' ports, a call portal for every other resolved
 * call, and a closed marker in every room holding calls the world cannot
 * follow (ambiguous, dynamic, external or unresolved; never a portal to a
 * guess). The hub holds a module portal to every module it imports or
 * re-exports from. Portals into other modules lead to units of their
 * areas, listed in `external`; the hub is the start room. Edges in
 * `portalOnly` (`source->target`) never become doors. A `seed` varies the
 * widths of columns and hubs, never what is connected; null keeps them plain.
 */
const toWorldGraph = (
  graph: CodeGraph,
  portalOnly: ReadonlySet<string> = new Set(),
  seed: number | null = null,
  module: ModuleNode | undefined = graph.modules[0]
): WorldGraph => {
  if (module === undefined) {
    return { rooms: [], connections: [], portals: [] };
  }
  const links = moduleLinks(graph, module);
  const world = moduleWorld(graph, module, links.length, portalOnly, seed);
  const pathOf = (id: string): string =>
    graph.modules.find((candidate) => candidate.id === id)?.path ?? id;
  const rooms = [...world.hubs, ...world.rooms];
  const portals = [
    ...world.portals,
    ...links.map((to, index): Portal => {
      const from =
        world.hubs[Math.floor(index / MODULE_PORTALS_PER_HUB)]?.id ?? module.id;
      return {
        id: modulePortalId(from, to),
        kind: "module",
        from,
        to,
        label: pathOf(to),
      };
    }),
  ];
  // Only calls and module portals leave the module; the rest stay inside.
  const ids = new Set(rooms.map((room) => room.id));
  const external = [
    ...new Set(
      portals
        .filter(({ kind }) => kind === "call" || kind === "module")
        .map((portal) => portal.to)
        .filter((to) => !ids.has(to))
    ),
  ].toSorted();
  return {
    rooms,
    connections: world.connections,
    portals,
    start: module.id,
    ...(external.length > 0 ? { external } : {}),
  };
};

export { edgeKey, linksOn, MODULE_PORTALS_PER_HUB, toWorldGraph };
