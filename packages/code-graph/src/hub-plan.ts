// The hubs of a module's area: the module's hub chain and a lobby (a chain
// too, when it must) for each top-level class whose methods hang off it,
// with the plain connections that join them to each other and to the
// functions they open onto.

import type { Connection, GraphRoom } from "@repo/types";

import type { ClassNode, FunctionNode, ModuleNode } from "./code-graph";
import { lobbyId } from "./ids";
import { hubDimensions } from "./room-size";
import { hubRatio } from "./variation";

/**
 * Doors per hub, links to other hubs included: what the layout places
 * reliably (the random generator's MAX_DEGREE). A module with more roots
 * chains further hubs (`demo.ts`, `demo.ts#2`, ...) instead of asking one
 * for walls it cannot have. Lobbies chain the same way.
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
 * Splits what hangs off a hub chain over its hubs so that no hub exceeds
 * MAX_HUB_DOORS once its links to the previous and next hub count;
 * `incoming` is the door into the first one from outside the chain (a
 * lobby's from its module hub). Module portals are not doors, so they do
 * not count. Always at least one group, possibly empty.
 */
const hubGroups = <T>(
  items: readonly T[],
  incoming = 0
): readonly (readonly T[])[] => {
  const groups: (readonly T[])[] = [];
  let remaining = items;
  do {
    const links = groups.length > 0 ? 1 : incoming;
    let take = Math.max(1, MAX_HUB_DOORS - links);
    if (remaining.length > take) {
      take = Math.max(1, take - 1);
    }
    groups.push(remaining.slice(0, take));
    remaining = remaining.slice(take);
  } while (remaining.length > 0);
  return groups;
};

/**
 * The class a function is a member of: the innermost declaration of its
 * `className` whose span holds it. Null for anything but a class member.
 */
const classOf = (
  fn: FunctionNode,
  classes: readonly ClassNode[]
): ClassNode | null => {
  let found: ClassNode | null = null;
  for (const candidate of classes) {
    if (
      candidate.name === fn.className &&
      candidate.span.start <= fn.span.start &&
      candidate.span.end >= fn.span.end &&
      (found === null || candidate.span.start >= found.span.start)
    ) {
      found = candidate;
    }
  }
  return found;
};

type HubPlanInput = {
  readonly module: ModuleNode;
  /** The functions that hang off the hub rather than a door, in source order. */
  readonly attached: readonly FunctionNode[];
  /** The module's classes. */
  readonly classes: readonly ClassNode[];
  /** Module portals on the hubs, MODULE_PORTALS_PER_HUB to each from the first on. */
  readonly links: number;
  readonly seed: number | null;
};

type HubPlan = {
  /** The module's hubs, chained in order; the first is its entrance. */
  readonly hubs: readonly GraphRoom[];
  /** Every class's lobby chain, class after class. */
  readonly lobbies: readonly GraphRoom[];
  readonly connections: readonly Connection[];
};

/** A class's lobby chain and its connections, methods in source order. */
const lobbyChain = (
  cls: ClassNode,
  methods: readonly FunctionNode[],
  seed: number | null
): { readonly rooms: GraphRoom[]; readonly connections: Connection[] } => {
  const groups = hubGroups(methods, 1);
  const rooms = groups.map((group, index): GraphRoom => {
    const id = lobbyId(cls.id, index);
    // The door in (from the module hub or the previous lobby), and on.
    const chain = 1 + (index < groups.length - 1 ? 1 : 0);
    return {
      id,
      label: `class ${cls.name}`,
      hub: true,
      ...hubDimensions(group.length + chain, hubRatio(seed, id)),
    };
  });
  const connections: Connection[] = [];
  groups.forEach((group, index) => {
    const room = rooms[index];
    const next = rooms[index + 1];
    if (room === undefined) {
      return;
    }
    if (next !== undefined) {
      connections.push({ from: room.id, to: next.id });
    }
    for (const fn of group) {
      connections.push({ from: room.id, to: fn.id });
    }
  });
  return { rooms, connections };
};

/**
 * A member of a top-level class hangs off its class's lobby, which takes
 * one door of the module hub at the place of its first such member; every
 * other attached function hangs off the hub itself. A class with no
 * attached members has no lobby; nested classes have none either.
 */
const planHubs = ({
  module,
  attached,
  classes,
  links,
  seed,
}: HubPlanInput): HubPlan => {
  const members = new Map<ClassNode, FunctionNode[]>();
  const items: string[] = [];
  for (const fn of attached) {
    const cls = fn.parentId === null ? classOf(fn, classes) : null;
    if (cls === null || !cls.topLevel) {
      items.push(fn.id);
      continue;
    }
    const methods = members.get(cls);
    if (methods === undefined) {
      members.set(cls, [fn]);
      items.push(lobbyId(cls.id, 0));
    } else {
      methods.push(fn);
    }
  }
  const rootGroups = hubGroups(items);
  const groups = [
    ...rootGroups,
    ...Array.from(
      {
        length: Math.max(
          0,
          Math.ceil(links / MODULE_PORTALS_PER_HUB) - rootGroups.length
        ),
      },
      (): readonly string[] => []
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
    for (const id of group) {
      connections.push({ from: hub.id, to: id });
    }
  });
  const lobbies: GraphRoom[] = [];
  for (const [cls, methods] of members) {
    const chain = lobbyChain(cls, methods, seed);
    lobbies.push(...chain.rooms);
    connections.push(...chain.connections);
  }
  return { hubs, lobbies, connections };
};

export { classOf, linksOn, MODULE_PORTALS_PER_HUB, planHubs };
