// A room's sides and the boxes its walls are built from: bounds, which way
// each wall faces, and the full-height walls and lintels around openings.

import type {
  DoorOpening,
  LaneLabel,
  Point,
  Rect,
  RoomData,
  WallSegment,
  WallSide,
} from "@repo/types";

import { DOOR_HEIGHT, WALL_HEIGHT, WALL_THICKNESS } from "./config";

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

export {
  EPSILON,
  INWARD,
  OPPOSITE,
  roomBounds,
  segmentFootprint,
  wallAxis,
  wallEdge,
  wallSegments,
};
