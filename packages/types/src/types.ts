// World units are metres. Y is up; every room sits on the y = 0 floor.

type Vec3 = readonly [number, number, number];

/** north = -Z edge, south = +Z, east = +X, west = -X. */
type WallSide = "north" | "south" | "east" | "west";

type RoomKind = "room" | "corridor";

type RoomSize = "small" | "medium" | "large";

// ---------------------------------------------------------------------------
// Graph layer: what connects to what, with no positions.

type GraphRoom = {
  readonly id: string;
  /** Extent along X once laid out. */
  readonly width: number;
  /** Extent along Z once laid out. */
  readonly depth: number;
  readonly size?: RoomSize;
  /** Free text for future code-flow features (function name, branch, ...). */
  readonly label?: string;
};

/** Undirected: a doorway is walkable both ways. */
type Connection = {
  readonly from: string;
  readonly to: string;
};

type WorldGraph = {
  readonly rooms: readonly GraphRoom[];
  readonly connections: readonly Connection[];
  /** Defaults to the first room. */
  readonly start?: string;
};

// ---------------------------------------------------------------------------
// Layout layer: rooms placed on the plane, doors as shared-edge facts.

type DoorData = {
  readonly wall: WallSide;
  readonly targetRoomId: string;
};

type RoomData = {
  readonly id: string;
  readonly kind: RoomKind;
  /** Centre of the floor; y is the floor level. */
  readonly position: Vec3;
  /** Extent along X. */
  readonly width: number;
  /** Extent along Z. */
  readonly depth: number;
  readonly doors: readonly DoorData[];
  /** For corridors: the graph connection this corridor implements. */
  readonly connection?: Connection;
};

type WorldData = {
  readonly rooms: readonly RoomData[];
  readonly startRoomId: string;
};

type WorldLayout = WorldData & {
  /** Graph connections the layout could not realise. Never silently dropped. */
  readonly unresolved: readonly Connection[];
};

// ---------------------------------------------------------------------------
// Built layer: wall boxes, openings and colliders derived from the layout.

/** Axis-aligned rectangle on the XZ plane. */
type Rect = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

type Point = {
  readonly x: number;
  readonly z: number;
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

/**
 * One door frame per connected pair, centred on the shared edge at floor
 * level. `axis` is the direction the opening runs along.
 */
type Doorway = {
  readonly center: Vec3;
  readonly axis: "x" | "z";
  readonly width: number;
  /** Through-wall depth: both rooms' inset walls together. */
  readonly depth: number;
};

type BuiltRoom = {
  readonly room: RoomData;
  readonly openings: readonly DoorOpening[];
  readonly segments: readonly WallSegment[];
};

type BuiltWorld = {
  readonly rooms: readonly BuiltRoom[];
  readonly doorways: readonly Doorway[];
  /** XZ footprints of every floor-level wall segment. */
  readonly colliders: readonly Rect[];
  readonly start: Point;
  /** A point the player faces at first: the start room's first doorway. */
  readonly facing: Point;
};

type GeneratedWorld = {
  readonly seed: number;
  readonly graph: WorldGraph;
  readonly layout: WorldLayout;
  readonly built: BuiltWorld;
};

export type {
  BuiltRoom,
  BuiltWorld,
  Connection,
  DoorData,
  DoorOpening,
  Doorway,
  GeneratedWorld,
  GraphRoom,
  Point,
  Rect,
  RoomData,
  RoomKind,
  RoomSize,
  Vec3,
  WallSegment,
  WallSide,
  WorldData,
  WorldGraph,
  WorldLayout,
};
