import type {
  ClusterPortal,
  Connection,
  GeneratedWorld,
  GraphRoom,
  Port,
  Portal,
  RoomCluster,
  WorldGraph,
} from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { FLOW_TOP_MIN_WIDTH } from "@repo/world-generator/config";
import { LayoutError } from "@repo/world-generator/layout";

import type {
  CallEdge,
  CallSite,
  CodeGraph,
  FunctionNode,
  ModuleNode,
} from "./code-graph";
import { layoutFlow, planFlow } from "./flow-layout";
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

const moduleWorld = (
  graph: CodeGraph,
  module: ModuleNode,
  extraHubDegree: number,
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
  const groups = hubGroups(attached, extraHubDegree);
  const hubs = groups.map((group, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < groups.length - 1 ? 1 : 0);
    const id = index === 0 ? module.id : `${module.id}#${index + 1}`;
    return {
      id,
      label: module.path,
      hub: true,
      ...hubDimensions(
        group.length + chain + (index === 0 ? extraHubDegree : 0),
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
 * The spatial grammar: one cluster per function (a column of flow rooms
 * with a return portal at its end), one hub per module that opens onto the
 * module's roots (more hubs chained when there are many), a door for each
 * call on the breadth-first tree from those roots through the rooms' ports,
 * a call portal for every other resolved call, and a closed marker in every
 * room holding calls the world cannot follow (ambiguous, dynamic,
 * external or unresolved; never a portal to a guess). The entrances of
 * successive modules are chained too, so the world is one connected
 * component, and the first module's entrance is the start room. Edges in
 * `portalOnly` (`source->target`) never become doors. A `seed` varies the
 * widths of columns and hubs, never what is connected; null keeps them plain.
 */
const toWorldGraph = (
  graph: CodeGraph,
  portalOnly: ReadonlySet<string> = new Set(),
  seed: number | null = null
): WorldGraph => {
  const rooms: GraphRoom[] = [];
  const connections: Connection[] = [];
  const portals: Portal[] = [];
  let previousHub: string | null = null;
  graph.modules.forEach((module, index) => {
    const chained =
      (index > 0 ? 1 : 0) + (index < graph.modules.length - 1 ? 1 : 0);
    const world = moduleWorld(graph, module, chained, portalOnly, seed);
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

type Plain = {
  readonly world: GeneratedWorld;
  /** The call edges demoted to portals, which fix the door/portal plan. */
  readonly portalOnly: ReadonlySet<string>;
};

/**
 * The plain world: a call door the layout cannot place is demoted to a
 * portal and the layout tried again, until everything fits.
 */
const plainWorld = (graph: CodeGraph, seed: number): Plain => {
  const portalOnly = new Set<string>();
  for (;;) {
    try {
      const world = generateWorld({
        seed,
        graph: toWorldGraph(graph, portalOnly),
        variation: false,
      });
      return { world, portalOnly };
    } catch (error) {
      const failed =
        error instanceof LayoutError && error.connection.kind === "call"
          ? edgeKey(error.connection.from, error.connection.to)
          : null;
      if (failed === null || portalOnly.has(failed)) {
        throw error;
      }
      portalOnly.add(failed);
    }
  }
};

/** Ids of what a layout left out: unresolved connections, unplaced portals. */
const gapsOf = ({ layout }: GeneratedWorld): string =>
  JSON.stringify([
    ...layout.unresolved.map(({ from, to }) => `${from}->${to}`).toSorted(),
    ...layout.unplacedPortals.map(({ id }) => id).toSorted(),
  ]);

/**
 * The code graph laid out; the seed only changes the placement. A call
 * door the layout cannot place (a call inside a lane offers one wall only,
 * and that side may be taken) is demoted to a portal and the layout tried
 * again, so a program that parses always becomes a world: tree calls are
 * walkable where the walls allow, the rest teleport. `variation` (on by
 * default) lets the seed vary proportions too: column and hub widths here,
 * corridor widths in the layout. Which calls are doors is decided on the
 * plain world first and kept; a varied layout that cannot realise exactly
 * that plan gives way to the plain world, so variation never changes what
 * is connected.
 */
const generateCodeWorld = (
  graph: CodeGraph,
  seed: number,
  { variation = true }: { readonly variation?: boolean } = {}
): GeneratedWorld => {
  const plain = plainWorld(graph, seed);
  if (!variation) {
    return plain.world;
  }
  try {
    const varied = generateWorld({
      seed,
      graph: toWorldGraph(graph, plain.portalOnly, seed),
    });
    return gapsOf(varied) === gapsOf(plain.world) ? varied : plain.world;
  } catch (error) {
    if (error instanceof LayoutError) {
      return plain.world;
    }
    throw error;
  }
};

export { generateCodeWorld, toWorldGraph };
