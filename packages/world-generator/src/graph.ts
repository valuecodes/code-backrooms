import type { Connection, GraphRoom, RoomSize, WorldGraph } from "@repo/types";

import { validateCluster } from "./cluster-graph";
import { GRID, MAX_DEGREE, MIN_SHARED, ROOM_SIZE_CLASSES } from "./config";
import { createRng, nextInt, pick, pickWeighted, shuffle } from "./random";
import type { Rng } from "./random";

/** Order-independent key for an undirected connection; ids may hold any characters. */
const connectionKey = (a: string, b: string): string =>
  JSON.stringify(a < b ? [a, b] : [b, a]);

/** Neighbour lists in connection order, both directions. */
const adjacencyOf = (
  graph: WorldGraph
): ReadonlyMap<string, readonly string[]> => {
  const adjacency = new Map<string, string[]>(
    graph.rooms.map((room) => [room.id, []])
  );
  for (const { from, to } of graph.connections) {
    adjacency.get(from)?.push(to);
    adjacency.get(to)?.push(from);
  }
  return adjacency;
};

const onGrid = (value: number): boolean =>
  Math.abs(value / GRID - Math.round(value / GRID)) < 1e-9;

/**
 * Rejects graphs the layout cannot honour, naming the offender. The
 * supported contract: unique ids, dimensions on the grid and at least
 * MIN_SHARED, undirected connections between distinct known rooms with no
 * duplicates, portals with unique ids from a known room (a cluster's rooms
 * included) to a known graph room (possibly its own; a jump's to a room of
 * the same cluster; a marker's to its own cluster room, which placed it and
 * gave it no target; a call's or module's possibly to an `external` unit,
 * none of which is a room here; a module's from a hub), clusters that satisfy
 * `validateCluster` and whose reserved ports and placed portals name known
 * rooms and portals, and one connected component over the connections.
 */
const validateGraph = (graph: WorldGraph): void => {
  if (graph.rooms.length === 0) {
    throw new Error("A world graph needs at least one room");
  }
  const ids = new Set<string>();
  for (const room of graph.rooms) {
    if (room.id === "" || ids.has(room.id)) {
      throw new Error(`Room id "${room.id}" is empty or duplicated`);
    }
    ids.add(room.id);
    for (const [name, value] of [
      ["width", room.width],
      ["depth", room.depth],
    ] as const) {
      if (!Number.isFinite(value) || value < MIN_SHARED || !onGrid(value)) {
        throw new Error(
          `Room "${room.id}" ${name} ${value} must be a multiple of ${GRID} and at least ${MIN_SHARED}`
        );
      }
    }
  }
  // Rooms a portal may sit on: graph rooms and the rooms inside clusters.
  const roomIds = new Set(ids);
  // The cluster (graph room) each cluster room belongs to, for jumps, and
  // every cluster jump portal, which the graph's must match.
  const unitOf = new Map<string, string>();
  const clusterJumps = new Map<string, string | undefined>();
  const clusterMarkers = new Set<string>();
  const placedPortals = new Map<string, string>();
  for (const room of graph.rooms) {
    if (room.cluster === undefined) {
      continue;
    }
    validateCluster(room, room.cluster, roomIds);
    for (const inner of room.cluster.rooms) {
      unitOf.set(inner.id, room.id);
    }
    for (const port of room.cluster.ports) {
      if (port.reservedFor !== undefined && !ids.has(port.reservedFor)) {
        throw new Error(
          `Cluster "${room.id}" reserves a port for unknown room "${port.reservedFor}"`
        );
      }
    }
    for (const portal of room.cluster.portals) {
      if (portal.kind === "jump") {
        clusterJumps.set(portal.id, portal.target);
      }
      if (portal.kind === "marker") {
        if (
          portal.target !== undefined ||
          portal.wall === undefined ||
          portal.along === undefined
        ) {
          throw new Error(
            `Marker "${portal.id}" must be placed by its cluster and lead nowhere`
          );
        }
        clusterMarkers.add(portal.id);
      }
      if (portal.wall !== undefined) {
        if (placedPortals.has(portal.id)) {
          throw new Error(
            `Portal "${portal.id}" is placed by more than one cluster room`
          );
        }
        placedPortals.set(portal.id, portal.roomId);
      }
    }
  }
  const keys = new Set<string>();
  for (const { from, to } of graph.connections) {
    if (!ids.has(from) || !ids.has(to)) {
      throw new Error(`Connection ${from} -> ${to} references an unknown room`);
    }
    if (from === to) {
      throw new Error(`Room "${from}" is connected to itself`);
    }
    const key = connectionKey(from, to);
    if (keys.has(key)) {
      throw new Error(`Connection ${from} -> ${to} is duplicated`);
    }
    keys.add(key);
  }
  // Units of other areas: a call or module portal may lead there.
  const external = new Set<string>();
  for (const id of graph.external ?? []) {
    if (id === "" || external.has(id) || roomIds.has(id)) {
      throw new Error(
        `External unit "${id}" is empty, duplicated or a room of this graph`
      );
    }
    external.add(id);
  }
  const hubs = new Set(
    graph.rooms.filter((room) => room.hub === true).map((room) => room.id)
  );
  const portalIds = new Set<string>();
  for (const portal of graph.portals ?? []) {
    if (
      portal.id === "" ||
      portalIds.has(portal.id) ||
      roomIds.has(portal.id)
    ) {
      throw new Error(
        `Portal id "${portal.id}" is empty, duplicated or already a room id`
      );
    }
    portalIds.add(portal.id);
    let known = ids.has(portal.to);
    if (portal.kind === "call" || portal.kind === "module") {
      known ||= external.has(portal.to);
    }
    if (portal.kind === "module" && !hubs.has(portal.from)) {
      throw new Error(
        `Module portal "${portal.id}" must leave a hub, not "${portal.from}"`
      );
    }
    if (portal.kind === "jump") {
      known =
        unitOf.has(portal.to) &&
        unitOf.get(portal.to) === unitOf.get(portal.from);
    } else if (portal.kind === "marker") {
      known = unitOf.has(portal.from) && portal.to === portal.from;
    }
    if (!roomIds.has(portal.from) || !known) {
      throw new Error(
        `Portal "${portal.id}" (${portal.from} -> ${portal.to}) references an unknown room`
      );
    }
    // A jump leads where its cluster says, so the cluster's reachability
    // holds for the world.
    if (
      clusterJumps.has(portal.id) !== (portal.kind === "jump") ||
      (clusterJumps.has(portal.id) && clusterJumps.get(portal.id) !== portal.to)
    ) {
      throw new Error(
        `Portal "${portal.id}" (${portal.kind} to ${portal.to}) does not match its cluster's jump portal`
      );
    }
    // A marker is one its cluster placed, so it never goes unplaced.
    if (clusterMarkers.has(portal.id) !== (portal.kind === "marker")) {
      throw new Error(
        `Portal "${portal.id}" (${portal.kind}) does not match its cluster's marker`
      );
    }
    const placedOn = placedPortals.get(portal.id);
    if (placedOn !== undefined && placedOn !== portal.from) {
      throw new Error(
        `Portal "${portal.id}" is placed on "${placedOn}" by its cluster but sits on "${portal.from}"`
      );
    }
  }
  for (const [id, roomId] of placedPortals) {
    if (!portalIds.has(id)) {
      throw new Error(
        `Cluster room "${roomId}" places portal "${id}", which the graph does not have`
      );
    }
  }
  const start = graph.start ?? graph.rooms[0]?.id;
  if (start === undefined || !ids.has(start)) {
    throw new Error(`Unknown start room "${start}"`);
  }
  const adjacency = adjacencyOf(graph);
  const seen = new Set<string>([start]);
  const queue = [start];
  // for...of sees rooms pushed while iterating, so this is a plain BFS.
  for (const current of queue) {
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = graph.rooms.find((room) => !seen.has(room.id));
  if (unreachable !== undefined) {
    throw new Error(
      `Room "${unreachable.id}" is not reachable from "${start}"`
    );
  }
};

type GenerateGraphOptions = {
  readonly seed: number;
  readonly roomCount: number;
};

const SIZE_WEIGHTS = (
  Object.keys(ROOM_SIZE_CLASSES) as readonly RoomSize[]
).map((size) => ({ value: size, weight: ROOM_SIZE_CLASSES[size].weight }));

/** A length in [min, max] on the grid. */
const randomExtent = (rng: Rng, size: RoomSize): number => {
  const { min, max } = ROOM_SIZE_CLASSES[size];
  return min + GRID * nextInt(rng, 0, Math.round((max - min) / GRID));
};

/** How many neighbours a room's walls can plausibly host: one per 8 m of perimeter. */
const capacity = (room: GraphRoom): number =>
  Math.min(
    MAX_DEGREE,
    Math.max(2, Math.floor((2 * (room.width + room.depth)) / 8))
  );

/** Fraction of extra, cycle-making connections on top of the spanning tree. */
const EXTRA_CONNECTIONS = 0.15;

/**
 * A random spanning tree (each new room hangs off an earlier one with spare
 * wall capacity) plus a few extra connections, so the layout has branches
 * and loops to deal with. Width and depth are drawn independently, so rooms
 * are rectangles, not squares.
 */
const generateGraph = ({
  seed,
  roomCount,
}: GenerateGraphOptions): WorldGraph => {
  if (!Number.isInteger(roomCount) || roomCount < 1) {
    throw new Error(`roomCount must be a positive integer, got ${roomCount}`);
  }
  const rng = createRng(seed);
  const rooms: GraphRoom[] = Array.from({ length: roomCount }, (_, index) => {
    const size = pickWeighted(rng, SIZE_WEIGHTS);
    return {
      id: `room-${index + 1}`,
      width: randomExtent(rng, size),
      depth: randomExtent(rng, size),
      size,
    };
  });
  const degree = new Map<string, number>(rooms.map((room) => [room.id, 0]));
  const keys = new Set<string>();
  const connections: Connection[] = [];
  const connect = (a: GraphRoom, b: GraphRoom) => {
    connections.push({ from: a.id, to: b.id });
    keys.add(connectionKey(a.id, b.id));
    degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
    degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
  };
  const hasRoom = (room: GraphRoom) =>
    (degree.get(room.id) ?? 0) < capacity(room);

  const parents = new Map<string, GraphRoom>();
  rooms.forEach((room, index) => {
    if (index === 0) {
      return;
    }
    const earlier = rooms.slice(0, index);
    const open = earlier.filter(hasRoom);
    const parent = pick(rng, open.length > 0 ? open : earlier);
    parents.set(room.id, parent);
    connect(parent, room);
  });

  // Extra connections join rooms two steps apart in the tree (siblings, or a
  // room and its grandparent). Those end up near each other on the plane, so
  // the layout can usually close the loop; distant pairs almost never can.
  const nearby: (readonly [GraphRoom, GraphRoom])[] = [];
  for (const room of rooms) {
    const parent = parents.get(room.id);
    const grandparent =
      parent === undefined ? undefined : parents.get(parent.id);
    if (grandparent !== undefined) {
      nearby.push([grandparent, room]);
    }
    for (const sibling of rooms) {
      if (
        sibling.id < room.id &&
        parents.get(sibling.id) === parent &&
        parent !== undefined
      ) {
        nearby.push([sibling, room]);
      }
    }
  }
  const extras = Math.round(EXTRA_CONNECTIONS * (roomCount - 1));
  let added = 0;
  for (const [a, b] of shuffle(rng, nearby)) {
    if (added >= extras) {
      break;
    }
    if (!keys.has(connectionKey(a.id, b.id)) && hasRoom(a) && hasRoom(b)) {
      connect(a, b);
      added += 1;
    }
  }
  return { rooms, connections, start: rooms[0]?.id };
};

export { adjacencyOf, connectionKey, generateGraph, validateGraph };
export type { GenerateGraphOptions };
