import type { Connection, GraphRoom, Portal, WorldGraph } from "@repo/types";

import type {
  CallEdge,
  CallSite,
  CodeGraph,
  FunctionNode,
  ModuleNode,
} from "./code-graph";
import {
  callPortalId,
  isFunctionId,
  parsePortalId,
  returnPortalId,
} from "./ids";
import { hubDimensions, roomDimensions } from "./room-size";

const lineCount = (fn: FunctionNode): number =>
  fn.span.endLine - fn.span.startLine + 1;

/**
 * Physical call doors out of one room. With its one incoming door (hub or
 * caller) a function room then never needs more walls than the layout's
 * MAX_DEGREE allows; further callees are reached through portals.
 */
const MAX_CALL_DOORS = 5;

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
  /** Every other resolved call: recursion, extra callers, cross-module. */
  readonly portalEdges: readonly CallEdge[];
};

/**
 * Which calls become doors: a breadth-first walk of the module's call graph
 * from its roots, each function entered once, at most MAX_CALL_DOORS doors
 * out of a room. A directed walk from the roots misses functions that only
 * cycles reach (`a <-> b` called by nobody else), so whatever is left over
 * is attached to the hub in source order and walked from there.
 */
const planModule = (
  graph: CodeGraph,
  functions: readonly FunctionNode[]
): ModulePlan => {
  const ids = new Set(functions.map((fn) => fn.id));
  const outgoing = new Map<string, CallEdge[]>();
  for (const edge of graph.edges) {
    if (edge.type === "call" && ids.has(edge.source)) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    }
  }
  const visited = new Set<string>();
  const attached: FunctionNode[] = [];
  const tree: CallEdge[] = [];
  const portalEdges: CallEdge[] = [];
  const walk = (seed: FunctionNode) => {
    attached.push(seed);
    visited.add(seed.id);
    const queue = [seed.id];
    // for...of sees ids pushed while iterating, so this is a plain BFS.
    for (const id of queue) {
      let doors = 0;
      for (const edge of outgoing.get(id) ?? []) {
        const local = ids.has(edge.target) && !visited.has(edge.target);
        if (local && doors < MAX_CALL_DOORS) {
          visited.add(edge.target);
          tree.push(edge);
          queue.push(edge.target);
          doors += 1;
        } else {
          portalEdges.push(edge);
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
    portalEdges,
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

/** The module a hub id belongs to: `demo.ts#2` → `demo.ts`. */
const hubModuleId = (roomId: string): string => roomId.replace(/#\d+$/, "");

type ModuleWorld = {
  /** The module's hubs, chained in order; the first is its entrance. */
  readonly hubs: readonly GraphRoom[];
  readonly rooms: readonly GraphRoom[];
  readonly connections: readonly Connection[];
  readonly portals: readonly Portal[];
};

const bump = (counts: Map<string, number>, id: string) =>
  counts.set(id, (counts.get(id) ?? 0) + 1);

const moduleWorld = (
  graph: CodeGraph,
  module: ModuleNode,
  extraHubDegree: number
): ModuleWorld => {
  const functions = graph.functions.filter((fn) => fn.moduleId === module.id);
  const { attached, tree, portalEdges } = planModule(graph, functions);
  const doors = new Map<string, number>(functions.map((fn) => [fn.id, 0]));
  // Every function room has a return portal; call portals add to that.
  const portalsOut = new Map<string, number>(functions.map((fn) => [fn.id, 1]));
  for (const edge of tree) {
    bump(doors, edge.source);
    bump(doors, edge.target);
  }
  for (const fn of attached) {
    bump(doors, fn.id);
  }
  for (const edge of portalEdges) {
    bump(portalsOut, edge.source);
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
  const rooms = functions.map((fn): GraphRoom => ({
    id: fn.id,
    label: fn.name,
    ...roomDimensions(
      lineCount(fn),
      doors.get(fn.id) ?? 0,
      portalsOut.get(fn.id) ?? 0
    ),
  }));
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
  const nameOf = (id: string): string =>
    graph.functions.find((fn) => fn.id === id)?.name ?? id;
  const portals: Portal[] = portalEdges.map((edge) => ({
    id: callPortalId(edge.callSiteIds[0] ?? `${edge.source}->${edge.target}`),
    kind: "call",
    from: edge.source,
    to: edge.target,
    label: nameOf(edge.target),
  }));
  portals.push(
    ...functions.map((fn): Portal => ({
      id: returnPortalId(fn.id),
      kind: "return",
      from: fn.id,
      to: module.id,
      label: "return",
    }))
  );
  return { hubs, rooms, connections, portals };
};

/**
 * The spatial grammar for this milestone: one room per function with a
 * return portal, one hub per module that opens onto the module's roots (more
 * hubs chained when there are many), a door for each call on the breadth-
 * first tree from those roots and a call portal for every other resolved
 * call. The entrances of successive modules are chained too, so the world is
 * one connected component, and the first module's entrance is the start room.
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

type RoomSubject =
  | { readonly kind: "module"; readonly module: ModuleNode }
  | {
      readonly kind: "function";
      readonly fn: FunctionNode;
      readonly module: ModuleNode;
    };

const functionSubject = (
  graph: CodeGraph,
  functionId: string
): { readonly fn: FunctionNode; readonly module: ModuleNode } | null => {
  const fn = graph.functions.find((candidate) => candidate.id === functionId);
  const module =
    fn === undefined
      ? undefined
      : graph.modules.find((candidate) => candidate.id === fn.moduleId);
  return fn === undefined || module === undefined ? null : { fn, module };
};

/** What a room stands for, or null for corridors and ids not from this graph. */
const roomSubject = (graph: CodeGraph, roomId: string): RoomSubject | null => {
  if (isFunctionId(roomId)) {
    const subject = functionSubject(graph, roomId);
    return subject === null ? null : { kind: "function", ...subject };
  }
  const moduleId = hubModuleId(roomId);
  const module = graph.modules.find((candidate) => candidate.id === moduleId);
  return module === undefined ? null : { kind: "module", module };
};

type PortalSubject =
  | {
      readonly kind: "call";
      readonly site: CallSite;
      readonly caller: FunctionNode;
      readonly callee: FunctionNode;
    }
  | { readonly kind: "return"; readonly fn: FunctionNode };

/** What a portal stands for, or null for ids not from this graph. */
const portalSubject = (
  graph: CodeGraph,
  portalId: string
): PortalSubject | null => {
  const ref = parsePortalId(portalId);
  if (ref === null) {
    return null;
  }
  if (ref.kind === "return") {
    const fn = functionSubject(graph, ref.functionId)?.fn;
    return fn === undefined ? null : { kind: "return", fn };
  }
  const site = graph.callSites.find(
    (candidate) => candidate.id === ref.callSiteId
  );
  const caller =
    site === undefined ? undefined : functionSubject(graph, site.callerId)?.fn;
  const callee =
    site?.calleeId === null || site?.calleeId === undefined
      ? undefined
      : functionSubject(graph, site.calleeId)?.fn;
  return site === undefined || caller === undefined || callee === undefined
    ? null
    : { kind: "call", site, caller, callee };
};

export { portalSubject, roomSubject, toWorldGraph };
export type { PortalSubject, RoomSubject };
