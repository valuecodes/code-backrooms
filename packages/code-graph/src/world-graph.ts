import type {
  ClusterPortal,
  Connection,
  GraphRoom,
  Port,
  Portal,
  RoomCluster,
  WorldGraph,
} from "@repo/types";

import type {
  CallEdge,
  CallSite,
  CodeGraph,
  FunctionNode,
  ModuleNode,
} from "./code-graph";
import { layoutFlow } from "./flow-layout";
import { hubDimensions } from "./room-size";

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

/**
 * Which calls become doors: a breadth-first walk of the module's call graph
 * from its roots, each function entered once, through the ports its rooms
 * offer (`candidates`: the callees a function has a port for). The door
 * therefore belongs to the caller that first reaches a function in that
 * walk, which is usually but not always its first caller in source order.
 * A directed walk from the roots misses functions that only cycles reach
 * (`a <-> b` called by nobody else), so whatever is left over is attached
 * to the hub in source order and walked from there.
 */
const planModule = (
  graph: CodeGraph,
  functions: readonly FunctionNode[],
  candidates: ReadonlyMap<string, ReadonlySet<string>>
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
          candidates.get(id)?.has(edge.target) === true
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
 * Splits the roots over hubs so that no hub exceeds MAX_HUB_DOORS once its
 * links to the previous and next hub (and `extraLinks` on the first) count.
 * Always at least one group, possibly empty.
 */
const hubGroups = (
  attached: readonly FunctionNode[],
  extraLinks: number
): readonly (readonly FunctionNode[])[] => {
  const groups: (readonly FunctionNode[])[] = [];
  let remaining = attached;
  do {
    const links =
      (groups.length > 0 ? 1 : 0) + (groups.length === 0 ? extraLinks : 0);
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
};

/**
 * A function's cluster once the doors are decided: the entry port and the
 * ports of the first call to each tree callee stay ports (a single callee
 * is offered both side walls, so those come as a pair); every other
 * reserved port becomes a call portal at its centre (recursion, extra
 * callers of a shared function, a second room calling the same callee),
 * one per call site. Portals get their graph form, `from` the flow room
 * and `to` the callee or the module hub.
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
      label: portal.kind === "return" ? "return" : nameOf(portal.target ?? ""),
    })
  );
  const toPortal = (portal: ClusterPortal): Portal => ({
    id: portal.id,
    kind: portal.kind,
    from: portal.roomId,
    to: portal.target ?? hubId,
    ...(portal.label === undefined ? {} : { label: portal.label }),
  });
  return {
    cluster: { ...cluster, ports: kept, portals },
    calls: portals.filter((portal) => portal.kind === "call").map(toPortal),
    returns: portals.filter((portal) => portal.kind === "return").map(toPortal),
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

const moduleWorld = (
  graph: CodeGraph,
  module: ModuleNode,
  extraHubDegree: number
): ModuleWorld => {
  const functions = graph.functions.filter((fn) => fn.moduleId === module.id);
  const sites = sitesByCaller(graph.callSites);
  const clusters = new Map(
    functions.map((fn) => [fn.id, layoutFlow(fn, sites.get(fn.id) ?? [])])
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
  const { attached, tree } = planModule(graph, functions, candidates);
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
  }
  const groups = hubGroups(attached, extraHubDegree);
  const hubs = groups.map((group, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < groups.length - 1 ? 1 : 0);
    return {
      id: index === 0 ? module.id : `${module.id}#${index + 1}`,
      label: module.path,
      hub: true,
      ...hubDimensions(
        group.length + chain + (index === 0 ? extraHubDegree : 0)
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
  return { hubs, rooms, connections, portals: [...calls, ...returns] };
};

/**
 * The spatial grammar: one cluster per function (a column of flow rooms
 * with a return portal at its end), one hub per module that opens onto the
 * module's roots (more hubs chained when there are many), a door for each
 * call on the breadth-first tree from those roots through the rooms' ports,
 * and a call portal for every other resolved call. The entrances of
 * successive modules are chained too, so the world is one connected
 * component, and the first module's entrance is the start room.
 */
const toWorldGraph = (graph: CodeGraph): WorldGraph => {
  const rooms: GraphRoom[] = [];
  const connections: Connection[] = [];
  const portals: Portal[] = [];
  let previousHub: string | null = null;
  graph.modules.forEach((module, index) => {
    const chained =
      (index > 0 ? 1 : 0) + (index < graph.modules.length - 1 ? 1 : 0);
    const world = moduleWorld(graph, module, chained);
    rooms.push(...world.hubs, ...world.rooms);
    const entrance = world.hubs[0];
    if (previousHub !== null && entrance !== undefined) {
      connections.push({ from: previousHub, to: entrance.id });
    }
    connections.push(...world.connections);
    portals.push(...world.portals);
    previousHub = entrance?.id ?? previousHub;
  });
  const start = graph.modules[0]?.id;
  return start === undefined
    ? { rooms, connections, portals }
    : { rooms, connections, portals, start };
};

export { toWorldGraph };
