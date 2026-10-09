import type { Portal, PortalData, RoomData, WallSide } from "@repo/types";

import { DOOR_WIDTH, GRID, PORTAL_GAP, WALL_THICKNESS } from "./config";
import { doorOpening, roomBounds, wallAxis } from "./geometry";

/**
 * A portal to place, or one that already has its wall and position (a
 * composite room decided it in its own coordinates): those are kept as they
 * are and only count as occupied wall.
 */
type PortalRequest = Portal & {
  readonly wall?: WallSide;
  readonly along?: number;
};

type PlacedPortals = {
  readonly rooms: readonly RoomData[];
  readonly unplaced: readonly Portal[];
};

/** Along-axis interval on one wall that something occupies. */
type Occupied = {
  readonly wall: WallSide;
  readonly lo: number;
  readonly hi: number;
};

type Candidate = {
  readonly wall: WallSide;
  readonly along: number;
  /** Length of the free interval the portal was centred in: more is better. */
  readonly room: number;
};

/** Door and portal centres sit on this lattice: shared-edge midpoints on the grid. */
const LATTICE = GRID / 2;

/** Walls are tried in this order, so ties resolve the same way every time. */
const WALLS: readonly WallSide[] = ["north", "east", "south", "west"];

const wallRange = (
  room: RoomData,
  wall: WallSide
): readonly [number, number] => {
  const bounds = roomBounds(room);
  return wallAxis(wall) === "x"
    ? [bounds.minX, bounds.maxX]
    : [bounds.minZ, bounds.maxZ];
};

const occupiedBy = (
  wall: WallSide,
  along: number,
  width: number
): Occupied => ({
  wall,
  lo: along - width / 2 - PORTAL_GAP,
  hi: along + width / 2 + PORTAL_GAP,
});

/** Free intervals of a wall once the corners and `occupied` are taken out. */
const freeIntervals = (
  room: RoomData,
  wall: WallSide,
  occupied: readonly Occupied[]
): readonly (readonly [number, number])[] => {
  const [lo, hi] = wallRange(room, wall);
  const inset = WALL_THICKNESS + PORTAL_GAP;
  const blocked = occupied
    .filter((item) => item.wall === wall)
    .sort((p, q) => p.lo - q.lo);
  const free: (readonly [number, number])[] = [];
  let cursor = lo + inset;
  for (const item of blocked) {
    if (item.lo > cursor) {
      free.push([cursor, item.lo]);
    }
    cursor = Math.max(cursor, item.hi);
  }
  if (hi - inset > cursor) {
    free.push([cursor, hi - inset]);
  }
  return free;
};

/**
 * The lattice point nearest the middle of [lo, hi] at which a portal still
 * fits inside it, or null when the interval is too short for one.
 */
const centreIn = (lo: number, hi: number): number | null => {
  const first = lo + DOOR_WIDTH / 2;
  const last = hi - DOOR_WIDTH / 2;
  if (last < first) {
    return null;
  }
  const middle = Math.round((first + last) / 2 / LATTICE) * LATTICE;
  const candidates = [middle, middle - LATTICE, middle + LATTICE];
  return candidates.find((value) => value >= first && value <= last) ?? null;
};

const bestCandidate = (
  room: RoomData,
  occupied: readonly Occupied[]
): Candidate | null => {
  let best: Candidate | null = null;
  for (const wall of WALLS) {
    for (const [lo, hi] of freeIntervals(room, wall, occupied)) {
      const along = centreIn(lo, hi);
      if (along !== null && (best === null || hi - lo > best.room)) {
        best = { wall, along, room: hi - lo };
      }
    }
  }
  return best;
};

/**
 * Gives every position-less portal a wall and an `along` on free wall space
 * of its room: clear of the corners, the door openings and the portals
 * already there, each centred in the longest free stretch so they spread
 * out. Deterministic, no rng. A portal that fits nowhere is reported, never
 * dropped; corridors never receive portals.
 */
const placePortals = (
  rooms: readonly RoomData[],
  portals: readonly PortalRequest[]
): PlacedPortals => {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const placed = new Map<string, PortalData[]>();
  const occupied = new Map<string, Occupied[]>();
  const occupy = (roomId: string, item: Occupied) =>
    occupied.set(roomId, [...(occupied.get(roomId) ?? []), item]);
  for (const room of rooms) {
    for (const door of room.doors) {
      const target = byId.get(door.targetRoomId);
      if (target !== undefined) {
        const opening = doorOpening(room, door, target);
        occupy(room.id, occupiedBy(opening.wall, opening.along, opening.width));
      }
    }
  }
  const unplaced: Portal[] = [];
  for (const request of portals) {
    const { wall, along, ...portal } = request;
    const room = byId.get(portal.from);
    if (room === undefined || room.kind === "corridor") {
      unplaced.push(portal);
      continue;
    }
    const chosen =
      wall !== undefined && along !== undefined
        ? { wall, along }
        : bestCandidate(room, occupied.get(room.id) ?? []);
    if (chosen === null) {
      unplaced.push(portal);
      continue;
    }
    placed.set(room.id, [
      ...(placed.get(room.id) ?? []),
      { ...portal, wall: chosen.wall, along: chosen.along },
    ]);
    occupy(room.id, occupiedBy(chosen.wall, chosen.along, DOOR_WIDTH));
  }
  return {
    rooms: rooms.map((room) => {
      const own = placed.get(room.id);
      return own === undefined ? room : { ...room, portals: own };
    }),
    unplaced,
  };
};

export { placePortals };
