import type {
  BuiltRoom,
  BuiltWorld,
  DoorData,
  DoorOpening,
  Doorway,
  Point,
  Rect,
  RoomData,
  WallSegment,
  WallSide,
  WorldData,
} from "@repo/types";

import { DOOR_HEIGHT, DOOR_WIDTH, WALL_HEIGHT, WALL_THICKNESS } from "./config";

const EPSILON = 1e-6;
const WALL_SIDES: readonly WallSide[] = ["north", "south", "east", "west"];
const OPPOSITE: Record<WallSide, WallSide> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
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
  return { wall: door.wall, along: (lo + hi) / 2, width: DOOR_WIDTH };
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

/** Full-height boxes between openings, plus a lintel above each opening. */
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
          segmentBox(span, cursor, gap.start, 0, WALL_HEIGHT, "wall")
        );
      }
      segments.push(
        segmentBox(span, gap.start, gap.end, DOOR_HEIGHT, WALL_HEIGHT, "lintel")
      );
      cursor = gap.end;
    }
    if (span.end > cursor + EPSILON) {
      segments.push(segmentBox(span, cursor, span.end, 0, WALL_HEIGHT, "wall"));
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
  const start = { x: startRoom.position[0], z: startRoom.position[2] };
  const firstDoor = rooms.find((built) => built.room.id === startRoom.id)
    ?.openings[0];
  const facing =
    firstDoor === undefined
      ? { x: start.x + 1, z: start.z }
      : openingCentre(startRoom, firstDoor);
  return { rooms, doorways, colliders, start, facing };
};

export {
  buildWorld,
  doorOpening,
  OPPOSITE,
  roomBounds,
  wallAxis,
  wallSegments,
};
