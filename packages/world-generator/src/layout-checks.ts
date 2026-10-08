import type { Rect, RoomData, WorldGraph, WorldLayout } from "@repo/types";

import {
  CORRIDOR_WIDTH,
  DOOR_WIDTH,
  MAX_CORRIDOR_LENGTH,
  MIN_GAP,
  MIN_SHARED,
  WALL_THICKNESS,
} from "./config";
import { rectGap, rectsOverlap, sharedEdge } from "./fit";
import { buildWorld, roomBounds } from "./geometry";
import { connectionKey } from "./graph";

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

  // Geometry: no overlaps, air between unrelated rooms, grid-aligned.
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
      } else if (doors.has(connectionKey(a.id, b.id))) {
        const edge = sharedEdge(ra, rb);
        if (edge === null || edge.overlap < MIN_SHARED) {
          failures.push(
            `${a.id} and ${b.id} have a door without a shared edge`
          );
        }
      } else if (rectGap(ra, rb) < MIN_GAP) {
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
      if (target?.kind === "room") {
        realised.add(connectionKey(room.id, target.id));
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
    const foot: Rect = {
      minX: x - PLAYER_RADIUS,
      maxX: x + PLAYER_RADIUS,
      minZ: z - PLAYER_RADIUS,
      maxZ: z + PLAYER_RADIUS,
    };
    if (built.colliders.some((collider) => rectsOverlap(foot, collider))) {
      failures.push(`doorway at ${x},${z} is blocked by a wall`);
    }
  }
  return failures;
};

export { checkLayout };
