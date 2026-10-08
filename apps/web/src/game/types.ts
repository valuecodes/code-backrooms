type Vec3 = readonly [number, number, number];

/** north = -Z edge, south = +Z, east = +X, west = -X. */
type WallSide = "north" | "south" | "east" | "west";

type DoorData = {
  readonly wall: WallSide;
  readonly targetRoomId: string;
};

type RoomData = {
  readonly id: string;
  /** Centre of the floor; y is the floor level. */
  readonly position: Vec3;
  /** Extent along X. */
  readonly width: number;
  /** Extent along Z. */
  readonly depth: number;
  readonly doors: readonly DoorData[];
};

type WorldData = {
  readonly rooms: readonly RoomData[];
  readonly startRoomId: string;
};

/** Axis-aligned rectangle on the XZ plane. */
type Rect = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

/** A gap in a wall: `along` is the world coordinate of its centre on the wall's axis. */
type DoorOpening = {
  readonly wall: WallSide;
  readonly along: number;
  readonly width: number;
};

/** An axis-aligned box in world space. Lintels span the top of a door opening. */
type WallSegment = {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly kind: "wall" | "lintel";
};

type BuiltRoom = {
  readonly room: RoomData;
  readonly openings: readonly DoorOpening[];
  readonly segments: readonly WallSegment[];
};

type BuiltWorld = {
  readonly rooms: readonly BuiltRoom[];
  /** XZ footprints of every floor-level wall segment. */
  readonly colliders: readonly Rect[];
  readonly start: { readonly x: number; readonly z: number };
};

export type {
  BuiltRoom,
  BuiltWorld,
  DoorData,
  DoorOpening,
  Rect,
  RoomData,
  Vec3,
  WallSegment,
  WallSide,
  WorldData,
};
