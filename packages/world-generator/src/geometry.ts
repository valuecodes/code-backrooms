import type {
  BuiltPortal,
  BuiltRoom,
  BuiltWorld,
  DoorData,
  DoorOpening,
  Doorway,
  Placement,
  Point,
  PortalData,
  Rect,
  RoomData,
  WallSide,
  WorldData,
} from "@repo/types";

import {
  ARRIVAL_INSET,
  DOOR_WIDTH,
  GRID,
  PASSAGE_JAMB,
  PASSAGE_MAX_WIDTH,
  PORTAL_TRIGGER_DEPTH,
  WALL_THICKNESS,
} from "./config";
import {
  EPSILON,
  INWARD,
  OPPOSITE,
  roomBounds,
  segmentFootprint,
  wallAxis,
  wallEdge,
  wallSegments,
} from "./walls";

/**
 * A passage takes the overlap less a jamb at each end, floored to the grid,
 * up to PASSAGE_MAX_WIDTH; never narrower than a door (a minimal overlap
 * leaves less than one).
 */
const passageWidth = (overlap: number): number => {
  const free = overlap - 2 * (WALL_THICKNESS + PASSAGE_JAMB);
  const snapped = Math.floor((free + EPSILON) / GRID) * GRID;
  return Math.max(DOOR_WIDTH, Math.min(PASSAGE_MAX_WIDTH, snapped));
};

/**
 * A door is centred on the overlap of the two rooms' shared edge. Both rooms
 * compute it from the same edge, so the openings always coincide; both
 * sides carry the same opening kind, so they agree on the width too.
 */
const doorOpening = (
  room: RoomData,
  door: DoorData,
  target: RoomData
): DoorOpening => {
  const a = roomBounds(room);
  const b = roomBounds(target);
  const edge = wallEdge(a, door.wall);
  const targetEdge = wallEdge(b, OPPOSITE[door.wall]);
  if (Math.abs(edge - targetEdge) > EPSILON) {
    throw new Error(
      `Rooms "${room.id}" and "${target.id}" do not share a ${door.wall} edge (${edge} vs ${targetEdge})`
    );
  }
  const alongX = wallAxis(door.wall) === "x";
  const lo = alongX ? Math.max(a.minX, b.minX) : Math.max(a.minZ, b.minZ);
  const hi = alongX ? Math.min(a.maxX, b.maxX) : Math.min(a.maxZ, b.maxZ);
  if (hi - lo < DOOR_WIDTH - EPSILON) {
    throw new Error(
      `Rooms "${room.id}" and "${target.id}" overlap by ${hi - lo} m, less than the ${DOOR_WIDTH} m door`
    );
  }
  return {
    wall: door.wall,
    along: (lo + hi) / 2,
    width: door.opening === "passage" ? passageWidth(hi - lo) : DOOR_WIDTH,
    ...(door.lane === undefined ? {} : { lane: door.lane }),
  };
};

/** Floor-level centre of an opening, on the room edge. */
const openingCentre = (room: RoomData, opening: DoorOpening): Point => {
  const edge = wallEdge(roomBounds(room), opening.wall);
  return wallAxis(opening.wall) === "x"
    ? { x: opening.along, z: edge }
    : { x: edge, z: opening.along };
};

/** The frame for an opening, centred on the room edge so it spans both walls. */
const doorway = (room: RoomData, opening: DoorOpening): Doorway => {
  const edge = wallEdge(roomBounds(room), opening.wall);
  const axis = wallAxis(opening.wall);
  return {
    center: axis === "x" ? [opening.along, 0, edge] : [edge, 0, opening.along],
    axis,
    width: opening.width,
    depth: 2 * WALL_THICKNESS,
    ...(opening.lane === undefined ? {} : { lane: opening.lane }),
  };
};

/** The floor point `inset` in from a wall at `along` on the wall's axis. */
const pointInside = (
  room: RoomData,
  wall: WallSide,
  along: number,
  inset: number
): Point => {
  const edge = wallEdge(roomBounds(room), wall);
  const inward = INWARD[wall];
  return wallAxis(wall) === "x"
    ? { x: along, z: edge + inward.z * inset }
    : { x: edge + inward.x * inset, z: along };
};

/** A landing just inside a wall at `along`, facing away from the wall. */
const placementInside = (
  room: RoomData,
  wall: WallSide,
  along: number,
  inset = ARRIVAL_INSET
): Placement => ({
  position: pointInside(room, wall, along, inset),
  facing: pointInside(room, wall, along, inset + 1),
});

/** The room's centre, facing `toward` (an opening's centre, or a point). */
const centreFacing = (
  room: RoomData,
  toward: DoorOpening | Point | undefined
): Placement => {
  const position = { x: room.position[0], z: room.position[2] };
  if (toward === undefined) {
    return { position, facing: { x: position.x + 1, z: position.z } };
  }
  return {
    position,
    facing: "wall" in toward ? openingCentre(room, toward) : toward,
  };
};

/**
 * Where a teleport into a room lands: just inside the wall its unit is
 * entered through (facing along the flow), else just inside its first
 * return portal (so turning round leads back out), else the centre facing
 * the first doorway, which is also how the start room is entered.
 */
const roomEntry = ({ room, openings }: BuiltRoom): Placement => {
  if (room.entry !== undefined) {
    const bounds = roomBounds(room);
    const [lo, hi] =
      wallAxis(room.entry) === "x"
        ? [bounds.minX, bounds.maxX]
        : [bounds.minZ, bounds.maxZ];
    return placementInside(room, room.entry, (lo + hi) / 2);
  }
  const exit = room.portals?.find((portal) => portal.kind === "return");
  if (exit !== undefined) {
    return placementInside(room, exit.wall, exit.along);
  }
  return centreFacing(room, openings[0]);
};

/**
 * Where a jump lands in a room of its own cluster: the centre, facing the
 * way on, which is the room's return portal when it ends the function and
 * otherwise its last doorway within the cluster (cluster doors are declared
 * in flow order, so that is the one onward: past a merge or end room,
 * `→ exit` from a loop's test; doors to callees come after them).
 */
const jumpArrival = (
  { room, openings }: BuiltRoom,
  byId: ReadonlyMap<string, RoomData>
): Placement => {
  const exit = room.portals?.find((portal) => portal.kind === "return");
  if (exit !== undefined) {
    return centreFacing(room, pointInside(room, exit.wall, exit.along, 0));
  }
  const onward = openings.filter((_, index) => {
    const target = byId.get(room.doors[index]?.targetRoomId ?? "");
    return target !== undefined && target.cluster === room.cluster;
  });
  return centreFacing(room, onward.at(-1) ?? openings.at(-1));
};

/**
 * A portal's frame sits on the wall's inner face (the wall behind stays
 * solid, so there is no opening); its trigger is a shallow strip of floor
 * in front of it.
 */
const buildPortal = (
  room: RoomData,
  portal: PortalData,
  entryOf: ReadonlyMap<string, Placement>
): BuiltPortal => {
  const arrival = entryOf.get(portal.to);
  if (arrival === undefined) {
    throw new Error(
      `Portal "${portal.id}" leads to unknown room "${portal.to}"`
    );
  }
  const { wall, along } = portal;
  const axis = wallAxis(wall);
  const centre = pointInside(room, wall, along, WALL_THICKNESS / 2);
  const face = pointInside(room, wall, along, WALL_THICKNESS);
  const reach = pointInside(
    room,
    wall,
    along,
    WALL_THICKNESS + PORTAL_TRIGGER_DEPTH
  );
  const half = DOOR_WIDTH / 2;
  const trigger: Rect =
    axis === "x"
      ? {
          minX: along - half,
          maxX: along + half,
          minZ: Math.min(face.z, reach.z),
          maxZ: Math.max(face.z, reach.z),
        }
      : {
          minX: Math.min(face.x, reach.x),
          maxX: Math.max(face.x, reach.x),
          minZ: along - half,
          maxZ: along + half,
        };
  return {
    portal,
    frame: {
      center: [centre.x, 0, centre.z],
      axis,
      width: DOOR_WIDTH,
      depth: WALL_THICKNESS,
    },
    normal: INWARD[wall],
    trigger,
    arrival,
    returnPoint: placementInside(room, wall, along),
  };
};

const buildRoom = (
  room: RoomData,
  byId: ReadonlyMap<string, RoomData>
): BuiltRoom => {
  const openings = room.doors.map((door) => {
    const target = byId.get(door.targetRoomId);
    if (target === undefined) {
      throw new Error(
        `Room "${room.id}" has a door to unknown room "${door.targetRoomId}"`
      );
    }
    const reciprocal = target.doors.some(
      (other) =>
        other.targetRoomId === room.id && other.wall === OPPOSITE[door.wall]
    );
    if (!reciprocal) {
      throw new Error(
        `Room "${target.id}" has no ${OPPOSITE[door.wall]} door back to "${room.id}"`
      );
    }
    return doorOpening(room, door, target);
  });
  return { room, openings, segments: wallSegments(room, openings) };
};

const buildWorld = (data: WorldData): BuiltWorld => {
  const byId = new Map(data.rooms.map((room) => [room.id, room]));
  const startRoom = byId.get(data.startRoomId);
  if (startRoom === undefined) {
    throw new Error(`Unknown start room "${data.startRoomId}"`);
  }
  const rooms = data.rooms.map((room) => buildRoom(room, byId));
  const colliders = rooms.flatMap((built) =>
    built.segments
      .filter((segment) => segment.kind === "wall")
      .map(segmentFootprint)
  );
  // Each shared edge is described by both rooms; keep one frame per pair.
  const doorways = rooms.flatMap((built) =>
    built.openings.flatMap((opening, index) => {
      const door = built.room.doors[index];
      return door !== undefined && built.room.id < door.targetRoomId
        ? [doorway(built.room, opening)]
        : [];
    })
  );
  const entryOf = new Map(
    rooms.map((built) => [built.room.id, roomEntry(built)])
  );
  // A portal into a unit lands in its entry room.
  for (const built of rooms) {
    const { cluster, entry } = built.room;
    if (cluster !== undefined && entry !== undefined) {
      entryOf.set(cluster, roomEntry(built));
    }
  }
  const jumpEntryOf = new Map(
    rooms.map((built) => [built.room.id, jumpArrival(built, byId)])
  );
  const portals = rooms.flatMap((built) =>
    (built.room.portals ?? []).map((portal) =>
      buildPortal(
        built.room,
        portal,
        portal.kind === "jump" ? jumpEntryOf : entryOf
      )
    )
  );
  const startBuilt = rooms.find((built) => built.room.id === startRoom.id);
  const entry =
    startBuilt === undefined ? null : (entryOf.get(startBuilt.room.id) ?? null);
  const start = entry?.position ?? {
    x: startRoom.position[0],
    z: startRoom.position[2],
  };
  const facing = entry?.facing ?? { x: start.x + 1, z: start.z };
  return { rooms, doorways, portals, colliders, start, facing };
};

export { buildWorld, doorOpening, openingCentre, placementInside };
export { OPPOSITE, roomBounds, wallAxis, wallSegments } from "./walls";
