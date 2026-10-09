// A cluster's internal contract, checked before the layout trusts it.

import type { GraphRoom, Rect, RoomCluster } from "@repo/types";

import {
  DOOR_WIDTH,
  GRID,
  MIN_SHARED,
  PORTAL_GAP,
  WALL_THICKNESS,
} from "./config";
import { rectsOverlap, sharedEdge } from "./fit";
import { wallAxis } from "./geometry";

/** Order-independent key for a door between two cluster rooms. */
const connectionKey = (a: string, b: string): string =>
  JSON.stringify(a < b ? [a, b] : [b, a]);

const onGrid = (value: number): boolean =>
  Math.abs(value / GRID - Math.round(value / GRID)) < 1e-9;

const rectOnGrid = (rect: Rect): boolean =>
  [rect.minX, rect.maxX, rect.minZ, rect.maxZ].every(onGrid);

/** The rooms of a cluster: on the grid, inside it, apart, filling its box. */
const clusterRects = (
  id: string,
  cluster: RoomCluster,
  roomIds: Set<string>
): Map<string, Rect> => {
  const { width, depth } = cluster;
  const rects = new Map<string, Rect>();
  let area = 0;
  const box = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const room of cluster.rooms) {
    if (room.id === "" || roomIds.has(room.id)) {
      throw new Error(
        `Cluster room id "${room.id}" in "${id}" is empty or duplicated`
      );
    }
    roomIds.add(room.id);
    const { rect } = room;
    if (
      !rectOnGrid(rect) ||
      rect.maxX <= rect.minX ||
      rect.maxZ <= rect.minZ ||
      rect.minX < 0 ||
      rect.minZ < 0 ||
      rect.maxX > width ||
      rect.maxZ > depth
    ) {
      throw new Error(
        `Cluster room "${room.id}" is off the grid or outside its ${width} x ${depth} cluster`
      );
    }
    for (const [otherId, other] of rects) {
      if (rectsOverlap(rect, other)) {
        throw new Error(`Cluster rooms "${room.id}" and "${otherId}" overlap`);
      }
    }
    rects.set(room.id, rect);
    area += (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
    box.minX = Math.min(box.minX, rect.minX);
    box.maxX = Math.max(box.maxX, rect.maxX);
    box.minZ = Math.min(box.minZ, rect.minZ);
    box.maxZ = Math.max(box.maxZ, rect.maxZ);
  }
  // Apart, inside, reaching every side and summing to the area: a tiling.
  if (
    box.minX !== 0 ||
    box.minZ !== 0 ||
    box.maxX !== width ||
    box.maxZ !== depth ||
    Math.abs(area - width * depth) > 1e-9
  ) {
    throw new Error(
      `Cluster "${id}" rooms do not fill its ${width} x ${depth} rectangle`
    );
  }
  return rects;
};

/**
 * A cluster's internal contract: rooms that tile its box, an entry room
 * across the top, doors with shared edges reaching every room, ports on the
 * boundary with exactly one entry port, and portals that are either placed
 * (wall and position) or not.
 */
const validateCluster = (
  room: GraphRoom,
  cluster: RoomCluster,
  roomIds: Set<string>
): void => {
  const { width, depth } = cluster;
  if (room.width !== width || room.depth !== depth) {
    throw new Error(
      `Room "${room.id}" is ${room.width} x ${room.depth} but its cluster is ${width} x ${depth}`
    );
  }
  const rects = clusterRects(room.id, cluster, roomIds);
  const entry = rects.get(cluster.entryRoomId);
  if (
    entry === undefined ||
    entry.minX !== 0 ||
    entry.maxX !== width ||
    entry.minZ !== 0
  ) {
    throw new Error(
      `Cluster "${room.id}" entry room must span the full width at z = 0`
    );
  }
  const adjacency = new Map<string, string[]>(
    cluster.rooms.map((inner) => [inner.id, []])
  );
  const keys = new Set<string>();
  for (const door of cluster.doors) {
    const a = rects.get(door.from);
    const b = rects.get(door.to);
    const key = connectionKey(door.from, door.to);
    if (a === undefined || b === undefined || door.from === door.to) {
      throw new Error(
        `Cluster door ${door.from} -> ${door.to} in "${room.id}" references an unknown room`
      );
    }
    if (keys.has(key)) {
      throw new Error(`Cluster door ${door.from} -> ${door.to} is duplicated`);
    }
    keys.add(key);
    const edge = sharedEdge(a, b);
    if (edge === null || edge.overlap < MIN_SHARED) {
      throw new Error(
        `Cluster door ${door.from} -> ${door.to} needs a shared edge of ${MIN_SHARED} m`
      );
    }
    adjacency.get(door.from)?.push(door.to);
    adjacency.get(door.to)?.push(door.from);
  }
  const seen = new Set([cluster.entryRoomId]);
  const queue = [cluster.entryRoomId];
  for (const current of queue) {
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = cluster.rooms.find((inner) => !seen.has(inner.id));
  if (unreachable !== undefined) {
    throw new Error(
      `Cluster room "${unreachable.id}" is not reachable from the entry`
    );
  }
  let entries = 0;
  for (const port of cluster.ports) {
    const rect = rects.get(port.roomId);
    if (rect === undefined) {
      throw new Error(`Cluster port on unknown room "${port.roomId}"`);
    }
    const onX = wallAxis(port.wall) === "x";
    const [lo, hi] = onX ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
    const boundary = {
      north: rect.minZ === 0,
      south: rect.maxZ === depth,
      east: rect.maxX === width,
      west: rect.minX === 0,
    }[port.wall];
    if (
      !onGrid(port.lo) ||
      !onGrid(port.hi) ||
      port.hi - port.lo < MIN_SHARED ||
      port.lo < lo ||
      port.hi > hi ||
      !boundary
    ) {
      throw new Error(
        `Cluster port on "${port.roomId}" ${port.wall} must lie on the cluster boundary, on the grid, at least ${MIN_SHARED} m long`
      );
    }
    if (port.reservedFor === undefined) {
      entries += 1;
      if (port.roomId !== cluster.entryRoomId || port.wall !== "north") {
        throw new Error(
          `Cluster "${room.id}" entry port must be on the entry room's north wall`
        );
      }
    }
  }
  if (entries !== 1) {
    throw new Error(`Cluster "${room.id}" must have exactly one entry port`);
  }
  for (const portal of cluster.portals) {
    const rect = rects.get(portal.roomId);
    if (rect === undefined) {
      throw new Error(
        `Cluster portal "${portal.id}" sits on unknown room "${portal.roomId}"`
      );
    }
    if ((portal.wall === undefined) !== (portal.along === undefined)) {
      throw new Error(
        `Cluster portal "${portal.id}" needs both a wall and a position, or neither`
      );
    }
    if (portal.wall !== undefined && portal.along !== undefined) {
      const [lo, hi] =
        wallAxis(portal.wall) === "x"
          ? [rect.minX, rect.maxX]
          : [rect.minZ, rect.maxZ];
      const margin = DOOR_WIDTH / 2 + WALL_THICKNESS + PORTAL_GAP;
      if (
        !Number.isFinite(portal.along) ||
        !onGrid(portal.along * 2) ||
        portal.along < lo + margin ||
        portal.along > hi - margin
      ) {
        throw new Error(
          `Cluster portal "${portal.id}" at ${portal.along} is off the lattice or too near a corner of its ${portal.wall} wall`
        );
      }
    }
  }
};

export { validateCluster };
