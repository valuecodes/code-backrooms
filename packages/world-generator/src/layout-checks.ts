import type {
  BuiltWorld,
  Point,
  Rect,
  RoomData,
  WorldGraph,
  WorldLayout,
} from "@repo/types";

import { checkClusters, unitLinks, unitOf } from "./cluster-checks";
import {
  CORRIDOR_WIDTH,
  DOOR_WIDTH,
  MAX_CORRIDOR_LENGTH,
  MIN_GAP,
  MIN_SHARED,
  PORTAL_GAP,
  WALL_THICKNESS,
} from "./config";
import { rectGap, rectsOverlap, sharedEdge } from "./fit";
import { buildWorld, roomBounds } from "./geometry";
import { connectionKey } from "./graph";
import { containsPoint } from "./locate";

/** Half-extent of the player's footprint, as the renderer uses it. */
const PLAYER_RADIUS = 0.3;

type Failure = string;

const doorKeys = (rooms: readonly RoomData[]): Set<string> =>
  new Set(
    rooms.flatMap((room) =>
      room.doors.map((door) => connectionKey(room.id, door.targetRoomId))
    )
  );

/**
 * Every invariant a layout must satisfy, as a list of failure messages so a
 * test can assert it is empty and still name what went wrong.
 */
const checkLayout = (graph: WorldGraph, layout: WorldLayout): Failure[] => {
  const failures: Failure[] = [];
  const rects = new Map<string, Rect>(
    layout.rooms.map((room) => [room.id, roomBounds(room)])
  );
  const doors = doorKeys(layout.rooms);
  const links = unitLinks(layout.rooms);

  // Geometry: no overlaps, air between unrelated units, grid-aligned. Rooms
  // of one unit, and of two units joined by a door, may stand flush.
  const rooms = layout.rooms;
  for (const [i, a] of rooms.entries()) {
    const ra = rects.get(a.id);
    if (ra === undefined) {
      continue;
    }
    for (const value of [ra.minX, ra.maxX, ra.minZ, ra.maxZ]) {
      if ((value * 4) % 1 !== 0) {
        failures.push(`${a.id} edge ${value} is off the quarter-metre lattice`);
      }
    }
    for (const b of rooms.slice(i + 1)) {
      const rb = rects.get(b.id);
      if (rb === undefined) {
        continue;
      }
      if (rectsOverlap(ra, rb)) {
        failures.push(`${a.id} overlaps ${b.id}`);
      } else if (unitOf(a) === unitOf(b)) {
        continue;
      } else if (doors.has(connectionKey(a.id, b.id))) {
        const edge = sharedEdge(ra, rb);
        if (edge === null || edge.overlap < MIN_SHARED) {
          failures.push(
            `${a.id} and ${b.id} have a door without a shared edge`
          );
        }
      } else if (
        !links.has(connectionKey(unitOf(a), unitOf(b))) &&
        rectGap(ra, rb) < MIN_GAP
      ) {
        failures.push(`${a.id} and ${b.id} are closer than ${MIN_GAP} m`);
      }
    }
  }

  // Connections: every input edge is realised or reported, nothing invented.
  const realised = new Set<string>();
  for (const room of rooms) {
    if (room.kind === "corridor") {
      if (room.connection === undefined) {
        failures.push(`${room.id} does not say which connection it serves`);
        continue;
      }
      realised.add(connectionKey(room.connection.from, room.connection.to));
      const long = Math.max(room.width, room.depth);
      const short = Math.min(room.width, room.depth);
      if (
        short !== CORRIDOR_WIDTH ||
        long < MIN_GAP ||
        long > MAX_CORRIDOR_LENGTH
      ) {
        failures.push(`${room.id} is ${room.width} x ${room.depth}`);
      }
      const rect = rects.get(room.id);
      for (const door of room.doors) {
        const other = rects.get(door.targetRoomId);
        const edge =
          rect !== undefined && other !== undefined
            ? sharedEdge(rect, other)
            : null;
        if (edge === null || edge.overlap !== CORRIDOR_WIDTH) {
          failures.push(
            `${room.id} end is not contained in ${door.targetRoomId}`
          );
        }
      }
      continue;
    }
    for (const door of room.doors) {
      const target = rooms.find(
        (candidate) => candidate.id === door.targetRoomId
      );
      if (target?.kind === "room" && unitOf(target) !== unitOf(room)) {
        realised.add(connectionKey(unitOf(room), unitOf(target)));
      }
    }
  }
  const input = new Set(
    graph.connections.map((connection) =>
      connectionKey(connection.from, connection.to)
    )
  );
  const unresolved = new Set(
    layout.unresolved.map((connection) =>
      connectionKey(connection.from, connection.to)
    )
  );
  for (const key of realised) {
    if (!input.has(key)) {
      failures.push(`door ${key} has no connection in the graph`);
    }
    if (unresolved.has(key)) {
      failures.push(`connection ${key} is both realised and unresolved`);
    }
  }
  for (const key of input) {
    if (!realised.has(key) && !unresolved.has(key)) {
      failures.push(`connection ${key} was dropped`);
    }
  }

  // Reachability over doors from the start room.
  const seen = new Set([layout.startRoomId]);
  const queue = [layout.startRoomId];
  for (const id of queue) {
    const current = rooms.find((room) => room.id === id);
    for (const door of current?.doors ?? []) {
      if (!seen.has(door.targetRoomId)) {
        seen.add(door.targetRoomId);
        queue.push(door.targetRoomId);
      }
    }
  }
  for (const room of rooms) {
    if (!seen.has(room.id)) {
      failures.push(`${room.id} is unreachable`);
    }
  }

  // Built geometry: openings clear of corners and of each other, walkable.
  let built;
  try {
    built = buildWorld(layout);
  } catch (error) {
    failures.push(`buildWorld failed: ${String(error)}`);
    return failures;
  }
  for (const { room, openings } of built.rooms) {
    const bounds = roomBounds(room);
    for (const [i, opening] of openings.entries()) {
      const [lo, hi] =
        opening.wall === "north" || opening.wall === "south"
          ? [bounds.minX, bounds.maxX]
          : [bounds.minZ, bounds.maxZ];
      const clearance = Math.min(
        opening.along - opening.width / 2 - lo,
        hi - opening.along - opening.width / 2
      );
      if (clearance < WALL_THICKNESS + 0.05) {
        failures.push(
          `${room.id} ${opening.wall} door is ${clearance} m from a corner`
        );
      }
      for (const other of openings.slice(i + 1)) {
        if (
          other.wall === opening.wall &&
          Math.abs(other.along - opening.along) < DOOR_WIDTH + 0.3
        ) {
          failures.push(
            `${room.id} has two ${opening.wall} doors too close together`
          );
        }
      }
    }
  }
  for (const doorway of built.doorways) {
    const [x, , z] = doorway.center;
    if (blocked(built.colliders, { x, z })) {
      failures.push(`doorway at ${x},${z} is blocked by a wall`);
    }
  }
  failures.push(...checkPortals(graph, layout, built));
  failures.push(...checkClusters(graph, layout));
  return failures;
};

const blocked = (colliders: readonly Rect[], point: Point): boolean => {
  const foot: Rect = {
    minX: point.x - PLAYER_RADIUS,
    maxX: point.x + PLAYER_RADIUS,
    minZ: point.z - PLAYER_RADIUS,
    maxZ: point.z + PLAYER_RADIUS,
  };
  return colliders.some((collider) => rectsOverlap(foot, collider));
};

const within = (rect: Rect, inner: Rect): boolean =>
  inner.minX >= rect.minX &&
  inner.maxX <= rect.maxX &&
  inner.minZ >= rect.minZ &&
  inner.maxZ <= rect.maxZ;

/**
 * Portals: every graph portal placed once or reported, none on a corridor,
 * clear of corners, doors and each other, with a trigger inside its room
 * and a walkable landing.
 */
const checkPortals = (
  graph: WorldGraph,
  layout: WorldLayout,
  built: BuiltWorld
): Failure[] => {
  const failures: Failure[] = [];
  const expected = new Set((graph.portals ?? []).map((portal) => portal.id));
  const seen = new Set<string>();
  for (const room of layout.rooms) {
    for (const portal of room.portals ?? []) {
      if (!expected.has(portal.id)) {
        failures.push(`portal ${portal.id} is not in the graph`);
      }
      if (seen.has(portal.id)) {
        failures.push(`portal ${portal.id} is placed twice`);
      }
      seen.add(portal.id);
      if (room.kind === "corridor") {
        failures.push(`portal ${portal.id} sits on corridor ${room.id}`);
      }
      if (portal.from !== room.id) {
        failures.push(
          `portal ${portal.id} sits on ${room.id}, not ${portal.from}`
        );
      }
    }
  }
  for (const portal of layout.unplacedPortals) {
    if (seen.has(portal.id)) {
      failures.push(`portal ${portal.id} is both placed and unplaced`);
    }
    seen.add(portal.id);
  }
  for (const id of expected) {
    if (!seen.has(id)) {
      failures.push(`portal ${id} was dropped`);
    }
  }
  for (const { room, openings } of built.rooms) {
    const bounds = roomBounds(room);
    const portals = room.portals ?? [];
    for (const [i, portal] of portals.entries()) {
      const [lo, hi] =
        portal.wall === "north" || portal.wall === "south"
          ? [bounds.minX, bounds.maxX]
          : [bounds.minZ, bounds.maxZ];
      const clearance = Math.min(
        portal.along - DOOR_WIDTH / 2 - lo,
        hi - portal.along - DOOR_WIDTH / 2
      );
      if (clearance < WALL_THICKNESS + PORTAL_GAP - 1e-9) {
        failures.push(
          `${room.id} ${portal.wall} portal is ${clearance} m from a corner`
        );
      }
      const others = [
        ...openings.map((opening) => [opening.wall, opening.along] as const),
        ...portals
          .slice(i + 1)
          .map((other) => [other.wall, other.along] as const),
      ];
      for (const [wall, along] of others) {
        if (
          wall === portal.wall &&
          Math.abs(along - portal.along) < DOOR_WIDTH + PORTAL_GAP - 1e-9
        ) {
          failures.push(
            `${room.id} ${portal.wall} portal is too close to an opening`
          );
        }
      }
    }
  }
  const rects = new Map(
    built.rooms.map(({ room }) => [room.id, roomBounds(room)])
  );
  // A portal into a unit lands in its entry room.
  for (const { room } of built.rooms) {
    if (room.cluster !== undefined && room.entry !== undefined) {
      rects.set(room.cluster, roomBounds(room));
    }
  }
  for (const portal of built.portals) {
    const own = rects.get(portal.portal.from);
    const target = rects.get(portal.portal.to);
    if (own === undefined || !within(own, portal.trigger)) {
      failures.push(`portal ${portal.portal.id} trigger leaves its room`);
    }
    const landing = portal.arrival.position;
    if (
      target === undefined ||
      !containsPoint(target, landing) ||
      blocked(built.colliders, landing)
    ) {
      failures.push(`portal ${portal.portal.id} lands somewhere unwalkable`);
    }
    if (blocked(built.colliders, portal.returnPoint.position)) {
      failures.push(`portal ${portal.portal.id} return point is in a wall`);
    }
  }
  return failures;
};

export { checkLayout };
