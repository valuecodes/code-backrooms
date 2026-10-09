// Invariants for clusters laid out as units: their rooms sit where the
// template puts them, keep the template's doors, and meet other units only
// through their ports.

import type { LaneLabel, RoomData, WorldGraph, WorldLayout } from "@repo/types";

import { OPPOSITE, roomBounds } from "./geometry";
import { connectionKey } from "./graph";
import { orient } from "./units";

/** The unit a room belongs to; a plain room or corridor is its own. */
const unitOf = (room: RoomData): string => room.cluster ?? room.id;

/** Unit pairs with a door between any of their rooms; corridors count as units. */
const unitLinks = (rooms: readonly RoomData[]): ReadonlySet<string> => {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const links = new Set<string>();
  for (const room of rooms) {
    for (const door of room.doors) {
      const target = byId.get(door.targetRoomId);
      if (target !== undefined && unitOf(room) !== unitOf(target)) {
        links.add(connectionKey(unitOf(room), unitOf(target)));
      }
    }
  }
  return links;
};

const sameLane = (a: LaneLabel | undefined, b: LaneLabel | undefined) =>
  a?.kind === b?.kind && a?.text === b?.text;

/** The unit on the far side of a door from `unit`: through a corridor if need be. */
const unitBeyond = (target: RoomData, unit: string): string => {
  const { connection } = target;
  if (connection === undefined) {
    return unitOf(target);
  }
  return connection.from === unit ? connection.to : connection.from;
};

const checkClusters = (graph: WorldGraph, layout: WorldLayout): string[] => {
  const failures: string[] = [];
  const byId = new Map(layout.rooms.map((room) => [room.id, room]));
  for (const graphRoom of graph.rooms) {
    const { cluster, id } = graphRoom;
    if (cluster === undefined) {
      continue;
    }
    const emitted = layout.rooms.filter((room) => room.cluster === id);
    if (emitted.length !== cluster.rooms.length) {
      failures.push(
        `${id} has ${emitted.length} rooms, its cluster ${cluster.rooms.length}`
      );
    }
    const entries = emitted.filter((room) => room.entry !== undefined);
    const entryWall = entries[0]?.entry;
    if (
      entries.length !== 1 ||
      entries[0]?.id !== cluster.entryRoomId ||
      entryWall === undefined
    ) {
      failures.push(`${id} does not have exactly one entry room`);
      continue;
    }
    const rects = emitted.map(roomBounds);
    const oriented = orient(cluster, OPPOSITE[entryWall], {
      x: Math.min(...rects.map((rect) => rect.minX)),
      z: Math.min(...rects.map((rect) => rect.minZ)),
    });
    for (const room of oriented.rooms) {
      const actual = byId.get(room.id);
      if (actual === undefined) {
        failures.push(`${room.id} of ${id} is missing`);
        continue;
      }
      const bounds = roomBounds(actual);
      if (
        bounds.minX !== room.rect.minX ||
        bounds.maxX !== room.rect.maxX ||
        bounds.minZ !== room.rect.minZ ||
        bounds.maxZ !== room.rect.maxZ
      ) {
        failures.push(`${room.id} is not where its cluster puts it`);
      }
      if (
        actual.kind !== "room" ||
        actual.role !== room.role ||
        !sameLane(actual.lane, room.lane)
      ) {
        failures.push(`${room.id} lost its kind, role or lane`);
      }
      for (const door of room.doors) {
        const kept = actual.doors.some(
          (candidate) =>
            candidate.wall === door.wall &&
            candidate.targetRoomId === door.targetRoomId &&
            sameLane(candidate.lane, door.lane)
        );
        if (!kept) {
          failures.push(
            `${room.id} lacks its ${door.wall} door to ${door.targetRoomId}`
          );
        }
      }
      for (const door of actual.doors) {
        const target = byId.get(door.targetRoomId);
        if (
          target?.cluster === id &&
          !room.doors.some((own) => own.targetRoomId === door.targetRoomId)
        ) {
          failures.push(
            `${room.id} has a door to ${door.targetRoomId} its cluster lacks`
          );
        }
      }
    }
    // Doors to other units sit on ports, one per port, for the unit reserved.
    const used = new Map<number, number>();
    for (const actual of emitted) {
      for (const door of actual.doors) {
        const target = byId.get(door.targetRoomId);
        if (target === undefined || target.cluster === id) {
          continue;
        }
        const other = unitBeyond(target, id);
        const index = oriented.ports.findIndex(
          (port) =>
            port.roomId === actual.id &&
            port.wall === door.wall &&
            (port.reservedFor === undefined || port.reservedFor === other)
        );
        if (index === -1) {
          failures.push(
            `${actual.id} ${door.wall} door to ${other} is not on a port`
          );
          continue;
        }
        used.set(index, (used.get(index) ?? 0) + 1);
      }
    }
    for (const [index, count] of used) {
      if (count > 1) {
        failures.push(`${id} port ${index} hosts ${count} doors`);
      }
    }
    for (const portal of oriented.portals) {
      const actual = byId.get(portal.roomId);
      const placed = actual?.portals?.some(
        (candidate) =>
          candidate.id === portal.id &&
          candidate.wall === portal.wall &&
          candidate.along === portal.along
      );
      if (placed !== true) {
        failures.push(`portal ${portal.id} is not where its cluster puts it`);
      }
    }
  }
  return failures;
};

export { checkClusters, unitLinks, unitOf };
