import type {
  BuiltPortal,
  BuiltRoom,
  BuiltWorld,
  DoorData,
  DoorOpening,
  Doorway,
  LaneLabel,
  Placement,
  Point,
  PortalData,
  Rect,
  RoomData,
  WallSegment,
  WallSide,
  WorldData,
} from "@repo/types";

import {
  ARRIVAL_INSET,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  PORTAL_TRIGGER_DEPTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from "./config";

const EPSILON = 1e-6;
const WALL_SIDES: readonly WallSide[] = ["north", "south", "east", "west"];
const OPPOSITE: Record<WallSide, WallSide> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};
/** Unit vector from a wall into its room. */
const INWARD: Record<WallSide, Point> = {
  north: { x: 0, z: 1 },
  south: { x: 0, z: -1 },
  east: { x: -1, z: 0 },
  west: { x: 1, z: 0 },
};

/** Walls on the north/south edges run along X; east/west walls run along Z. */
const wallAxis = (wall: WallSide): "x" | "z" =>
  wall === "north" || wall === "south" ? "x" : "z";

const roomBounds = (room: RoomData): Rect => {
  const [x, , z] = room.position;
  return {
    minX: x - room.width / 2,
    maxX: x + room.width / 2,
    minZ: z - room.depth / 2,
    maxZ: z + room.depth / 2,
  };
};

/** The fixed coordinate of a room edge: z for north/south, x for east/west. */
const wallEdge = (bounds: Rect, wall: WallSide): number =>
  ({
    north: bounds.minZ,
    south: bounds.maxZ,
    east: bounds.maxX,
    west: bounds.minX,
  })[wall];

/**
 * A door is centred on the overlap of the two rooms' shared edge. Both rooms
 * compute it from the same edge, so the openings always coincide.
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
    width: DOOR_WIDTH,
    ...(door.lane === undefined ? {} : { lane: door.lane }),
  };
};

type WallSpan = {
  readonly wall: WallSide;
  readonly start: number;
  readonly end: number;
  readonly edge: number;
};

/**
 * North/south walls span the full width; east/west walls stop short of the
 * corners by one wall thickness so the boxes never overlap.
 */
const wallSpan = (bounds: Rect, wall: WallSide): WallSpan => {
  const edge = wallEdge(bounds, wall);
  return wallAxis(wall) === "x"
    ? { wall, edge, start: bounds.minX, end: bounds.maxX }
    : {
        wall,
        edge,
        start: bounds.minZ + WALL_THICKNESS,
        end: bounds.maxZ - WALL_THICKNESS,
      };
};

const segmentBox = (
  span: WallSpan,
  start: number,
  end: number,
  bottom: number,
  top: number,
  kind: WallSegment["kind"]
): WallSegment => {
  const along = (start + end) / 2;
  const length = end - start;
  const y = (bottom + top) / 2;
  const height = top - bottom;
  // Inset: the box sits just inside the room edge.
  const inward = span.wall === "north" || span.wall === "west" ? 1 : -1;
  const across = span.edge + (inward * WALL_THICKNESS) / 2;
  return wallAxis(span.wall) === "x"
    ? {
        center: [along, y, across],
        size: [length, height, WALL_THICKNESS],
        kind,
      }
    : {
        center: [across, y, along],
        size: [WALL_THICKNESS, height, length],
        kind,
      };
};

const tinted = (
  segment: WallSegment,
  lane: LaneLabel | undefined
): WallSegment => (lane === undefined ? segment : { ...segment, lane });

/**
 * Full-height boxes between openings, plus a lintel above each opening.
 * Walls carry the room's lane, lintels their door's (or the room's when
 * the door has none), so the renderer can tint a lane and its doors.
 */
const wallSegments = (
  room: RoomData,
  openings: readonly DoorOpening[]
): WallSegment[] => {
  const bounds = roomBounds(room);
  const segments: WallSegment[] = [];
  for (const wall of WALL_SIDES) {
    const span = wallSpan(bounds, wall);
    const gaps = openings
      .filter((opening) => opening.wall === wall)
      .map((opening) => ({
        start: Math.max(span.start, opening.along - opening.width / 2),
        end: Math.min(span.end, opening.along + opening.width / 2),
        lane: opening.lane,
      }))
      .sort((p, q) => p.start - q.start);
    let cursor = span.start;
    for (const gap of gaps) {
      if (gap.start < cursor - EPSILON) {
        throw new Error(
          `Room "${room.id}" has overlapping door openings on its ${wall} wall`
        );
      }
      if (gap.start > cursor + EPSILON) {
        segments.push(
          tinted(
            segmentBox(span, cursor, gap.start, 0, WALL_HEIGHT, "wall"),
            room.lane
          )
        );
      }
      segments.push(
        tinted(
          segmentBox(
            span,
            gap.start,
            gap.end,
            DOOR_HEIGHT,
            WALL_HEIGHT,
            "lintel"
          ),
          gap.lane ?? room.lane
        )
      );
      cursor = gap.end;
    }
    if (span.end > cursor + EPSILON) {
      segments.push(
        tinted(
          segmentBox(span, cursor, span.end, 0, WALL_HEIGHT, "wall"),
          room.lane
        )
      );
    }
  }
  return segments;
};

const segmentFootprint = (segment: WallSegment): Rect => {
  const [x, , z] = segment.center;
  const [w, , d] = segment.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
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
  const position = { x: room.position[0], z: room.position[2] };
  const first = openings[0];
  return {
    position,
    facing:
      first === undefined
        ? { x: position.x + 1, z: position.z }
        : openingCentre(room, first),
  };
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
  const portals = rooms.flatMap((built) =>
    (built.room.portals ?? []).map((portal) =>
      buildPortal(built.room, portal, entryOf)
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

export {
  buildWorld,
  doorOpening,
  openingCentre,
  OPPOSITE,
  placementInside,
  roomBounds,
  wallAxis,
  wallSegments,
};
