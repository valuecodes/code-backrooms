import type { Connection, GraphRoom, WorldGraph } from "@repo/types";

import type { CodeGraph, FunctionNode, ModuleNode } from "./code-graph";
import { isFunctionId } from "./ids";
import { hubDimensions, roomDimensions } from "./room-size";

/** Order-independent key for an undirected pair; ids may hold any characters. */
const pairKey = (a: string, b: string): string =>
  JSON.stringify(a < b ? [a, b] : [b, a]);

const lineCount = (fn: FunctionNode): number =>
  fn.span.endLine - fn.span.startLine + 1;

type Pair = readonly [string, string];

/**
 * Resolved function-to-function calls as undirected pairs: recursion dropped
 * (a room cannot have a door to itself), repeats and reversals collapsed to
 * one, first occurrence wins.
 */
const callPairs = (graph: CodeGraph): readonly Pair[] => {
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const edge of graph.edges) {
    if (edge.type !== "call" || edge.source === edge.target) {
      continue;
    }
    const key = pairKey(edge.source, edge.target);
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push([edge.source, edge.target]);
    }
  }
  return pairs;
};

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

/** Connected components over the undirected pairs, keyed by function id. */
const componentsOf = (
  functions: readonly FunctionNode[],
  pairs: readonly Pair[]
): ReadonlyMap<string, number> => {
  const parent = new Map<string, string>(functions.map((fn) => [fn.id, fn.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    return root;
  };
  for (const [a, b] of pairs) {
    if (parent.has(a) && parent.has(b)) {
      parent.set(find(a), find(b));
    }
  }
  const index = new Map<string, number>();
  const component = new Map<string, number>();
  for (const fn of functions) {
    const root = find(fn.id);
    if (!index.has(root)) {
      index.set(root, index.size);
    }
    component.set(fn.id, index.get(root) ?? 0);
  }
  return component;
};

/**
 * Which functions of a module hang off its hub: every root, plus the first
 * function of any component without a root (mutual recursion), so the whole
 * module stays reachable from the hub.
 */
const hubAttached = (
  graph: CodeGraph,
  functions: readonly FunctionNode[],
  pairs: readonly Pair[]
): readonly FunctionNode[] => {
  const roots = rootsOf(graph, functions);
  const component = componentsOf(functions, pairs);
  const covered = new Set(roots.map((fn) => component.get(fn.id)));
  const attached = [...roots];
  for (const fn of functions) {
    const id = component.get(fn.id);
    if (id !== undefined && !covered.has(id)) {
      covered.add(id);
      attached.push(fn);
    }
  }
  return attached.sort((a, b) => a.span.start - b.span.start);
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
};

const moduleWorld = (
  graph: CodeGraph,
  module: ModuleNode,
  pairs: readonly Pair[],
  extraHubDegree: number
): ModuleWorld => {
  const functions = graph.functions.filter((fn) => fn.moduleId === module.id);
  const ids = new Set(functions.map((fn) => fn.id));
  const local = pairs.filter(([a, b]) => ids.has(a) && ids.has(b));
  const attached = hubAttached(graph, functions, local);
  const degree = new Map<string, number>(functions.map((fn) => [fn.id, 0]));
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const [a, b] of local) {
    bump(a);
    bump(b);
  }
  for (const fn of attached) {
    bump(fn.id);
  }
  const groups = hubGroups(attached, extraHubDegree);
  const hubs = groups.map((group, index): GraphRoom => {
    const chain = (index > 0 ? 1 : 0) + (index < groups.length - 1 ? 1 : 0);
    return {
      id: index === 0 ? module.id : `${module.id}#${index + 1}`,
      label: module.path,
      ...hubDimensions(
        group.length + chain + (index === 0 ? extraHubDegree : 0)
      ),
    };
  });
  const rooms = functions.map((fn): GraphRoom => ({
    id: fn.id,
    label: fn.name,
    ...roomDimensions(lineCount(fn), degree.get(fn.id) ?? 0),
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
  connections.push(...local.map(([from, to]) => ({ from, to })));
  return { hubs, rooms, connections };
};

/**
 * The spatial grammar for this milestone: one room per function, one door per
 * resolved call, one hub per module that opens onto the module's roots (more
 * hubs chained when there are many). The entrances of successive modules are
 * chained too, so the world is one connected component, and the first module's
 * entrance is the start room.
 */
const toWorldGraph = (graph: CodeGraph): WorldGraph => {
  const pairs = callPairs(graph);
  const rooms: GraphRoom[] = [];
  const connections: Connection[] = [];
  let previousHub: string | null = null;
  graph.modules.forEach((module, index) => {
    const chained =
      (index > 0 ? 1 : 0) + (index < graph.modules.length - 1 ? 1 : 0);
    const world = moduleWorld(graph, module, pairs, chained);
    rooms.push(...world.hubs, ...world.rooms);
    const entrance = world.hubs[0];
    if (previousHub !== null && entrance !== undefined) {
      connections.push({ from: previousHub, to: entrance.id });
    }
    connections.push(...world.connections);
    previousHub = entrance?.id ?? previousHub;
  });
  const start = graph.modules[0]?.id;
  return start === undefined
    ? { rooms, connections }
    : { rooms, connections, start };
};

type RoomSubject =
  | { readonly kind: "module"; readonly module: ModuleNode }
  | {
      readonly kind: "function";
      readonly fn: FunctionNode;
      readonly module: ModuleNode;
    };

/** What a room stands for, or null for corridors and ids not from this graph. */
const roomSubject = (graph: CodeGraph, roomId: string): RoomSubject | null => {
  if (isFunctionId(roomId)) {
    const fn = graph.functions.find((candidate) => candidate.id === roomId);
    const module =
      fn === undefined
        ? undefined
        : graph.modules.find((candidate) => candidate.id === fn.moduleId);
    return fn === undefined || module === undefined
      ? null
      : { kind: "function", fn, module };
  }
  const moduleId = hubModuleId(roomId);
  const module = graph.modules.find((candidate) => candidate.id === moduleId);
  return module === undefined ? null : { kind: "module", module };
};

export { roomSubject, toWorldGraph };
export type { RoomSubject };
