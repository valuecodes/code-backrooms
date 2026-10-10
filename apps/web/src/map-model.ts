import type {
  BuiltWorld,
  LaneKind,
  Point,
  PortalKind,
  Rect,
  RoomKind,
} from "@repo/types";
import { openingCentre, roomBounds } from "@repo/world-generator/geometry";

// What the overview map draws, worked out without React or the DOM: the rooms
// the player has stood in, the rooms seen through their doors, and the doors
// and portals of the rooms stood in.

/** The rooms stood in, for one world; another world starts an empty set. */
type Visits = {
  readonly world: BuiltWorld | null;
  readonly rooms: ReadonlySet<string>;
};

type MapRoom = {
  readonly id: string;
  readonly rect: Rect;
  readonly kind: RoomKind;
  readonly lane: LaneKind | null;
  /** False for a room only seen through a door: it is drawn hollow. */
  readonly visited: boolean;
  /** The room the player stands in. */
  readonly current: boolean;
};

type MapDoor = {
  readonly point: Point;
  readonly lane: LaneKind | null;
};

type MapPortal = {
  readonly id: string;
  readonly kind: PortalKind;
  /** The centre of the frame, on the wall. */
  readonly point: Point;
  /** Unit vector out of the wall into the room. */
  readonly normal: Point;
};

type MapModel = {
  readonly rooms: readonly MapRoom[];
  readonly doors: readonly MapDoor[];
  readonly portals: readonly MapPortal[];
};

const NO_ROOMS: ReadonlySet<string> = new Set();

const EMPTY_VISITS: Visits = { world: null, rooms: NO_ROOMS };

/** The visited rooms of `world`, or none when `visits` belongs to another. */
const visitedIn = (
  visits: Visits,
  world: BuiltWorld | null
): ReadonlySet<string> => (visits.world === world ? visits.rooms : NO_ROOMS);

/**
 * Records that the player stands in `roomId` of `world`. Unchanged (the same
 * object) outside every room or in a room already recorded, so a React state
 * update with it does not re-render.
 */
const visit = (
  visits: Visits,
  world: BuiltWorld | null,
  roomId: string | null
): Visits => {
  const rooms = visitedIn(visits, world);
  if (roomId === null) {
    return visits.world === world ? visits : { world, rooms };
  }
  if (rooms.has(roomId) && visits.world === world) {
    return visits;
  }
  return { world, rooms: new Set([...rooms, roomId]) };
};

/** Doors on a shared wall are reported by both rooms at the same point. */
const pointKey = ({ x, z }: Point): string => `${x.toFixed(3)},${z.toFixed(3)}`;

const mapModel = (
  world: BuiltWorld,
  visited: ReadonlySet<string>,
  current: string | null
): MapModel => {
  const entered = world.rooms.filter(({ room }) => visited.has(room.id));
  const seen = new Set(
    entered.flatMap(({ room }) => [
      room.id,
      ...room.doors.map((door) => door.targetRoomId),
    ])
  );
  const rooms = world.rooms
    .filter(({ room }) => seen.has(room.id))
    .map(({ room }): MapRoom => ({
      id: room.id,
      rect: roomBounds(room),
      kind: room.kind,
      lane: room.lane?.kind ?? null,
      visited: visited.has(room.id),
      current: room.id === current,
    }));
  const doors = new Map<string, MapDoor>();
  for (const { room, openings } of entered) {
    for (const opening of openings) {
      const point = openingCentre(room, opening);
      const key = pointKey(point);
      if (!doors.has(key)) {
        doors.set(key, { point, lane: opening.lane?.kind ?? null });
      }
    }
  }
  const portals = world.portals
    .filter(({ portal }) => visited.has(portal.from))
    .map(({ portal, frame, normal }): MapPortal => ({
      id: portal.id,
      kind: portal.kind,
      point: { x: frame.center[0], z: frame.center[2] },
      normal,
    }));
  return { rooms, doors: [...doors.values()], portals };
};

export { EMPTY_VISITS, mapModel, visit, visitedIn };
export type { MapPortal, MapRoom };
