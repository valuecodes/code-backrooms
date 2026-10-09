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
  /** A module hub: entering it empties the navigation stack. */
  readonly hub?: boolean;
};

type ConnectionKind = "call";

/** Undirected: a doorway is walkable both ways. */
type Connection = {
  readonly from: string;
  readonly to: string;
  /**
   * `call`: `from` calls `to`. Walking from -> to pushes a navigation frame
   * and walking back pops it. Absent for plain adjacency (hub doors, presets).
   */
  readonly kind?: ConnectionKind;
};

/**
 * `call`: stepping in enters `to` and pushes a navigation frame. `return`:
 * pops the stack, or lands in `to` (the module hub) when it is empty. `jump`:
 * a plain teleport to `to` that leaves the stack alone.
 */
type PortalKind = "call" | "return" | "jump";

/**
 * A directed jump drawn as a door-like frame on a wall of `from`. Not part of
 * the connectivity the layout places: the wall behind it stays solid.
 */
type Portal = {
  readonly id: string;
  readonly kind: PortalKind;
  /** The room whose wall hosts the portal. */
  readonly from: string;
  /** Where it leads; may equal `from` (recursion). */
  readonly to: string;
  /** Free text, like GraphRoom.label (the callee's name). */
  readonly label?: string;
};

type WorldGraph = {
  readonly rooms: readonly GraphRoom[];
  readonly connections: readonly Connection[];
  /** Portals on room walls, placed on free wall space after the doors. */
  readonly portals?: readonly Portal[];
  /** Defaults to the first room. */
  readonly start?: string;
};

// ---------------------------------------------------------------------------
// Layout layer: rooms placed on the plane, doors as shared-edge facts.

type DoorData = {
  readonly wall: WallSide;
  readonly targetRoomId: string;
};

/** A portal on a wall: `along` is the world coordinate of its centre on the wall's axis. */
type PortalData = Portal & {
  readonly wall: WallSide;
  readonly along: number;
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
  /** Portals on this room's walls; corridors have none. Defaults to none. */
  readonly portals?: readonly PortalData[];
  /** For corridors: the graph connection this corridor implements. */
  readonly connection?: Connection;
  /**
   * The unit this room belongs to when several rooms stand for one graph
   * room (a function laid out as several flow rooms). Absent: the room is
   * its own unit.
   */
  readonly cluster?: string;
};

type WorldData = {
  readonly rooms: readonly RoomData[];
  readonly startRoomId: string;
};

type WorldLayout = WorldData & {
  /** Graph connections the layout could not realise. Never silently dropped. */
  readonly unresolved: readonly Connection[];
  /** Graph portals no wall had free space for. Never silently dropped. */
  readonly unplacedPortals: readonly Portal[];
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
  /** Through-wall depth: both rooms' inset walls together, or one wall for a portal. */
  readonly depth: number;
};

/** A floor point and a point to look at: where the player lands or starts. */
type Placement = {
  readonly position: Point;
  readonly facing: Point;
};

type BuiltPortal = {
  readonly portal: PortalData;
  /** A frame on the wall's inner face, shaped like a doorway. */
  readonly frame: Doorway;
  /** Unit vector from the wall into the room. */
  readonly normal: Point;
  /** Floor rect just inside the frame: a player centre in it can enter. */
  readonly trigger: Rect;
  /** Where the portal takes the player: inside `portal.to`. */
  readonly arrival: Placement;
  /** Just inside this portal, facing into its room: where a return lands. */
  readonly returnPoint: Placement;
};

type BuiltRoom = {
  readonly room: RoomData;
  readonly openings: readonly DoorOpening[];
  readonly segments: readonly WallSegment[];
};

type BuiltWorld = {
  readonly rooms: readonly BuiltRoom[];
  readonly doorways: readonly Doorway[];
  readonly portals: readonly BuiltPortal[];
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
  BuiltPortal,
  BuiltRoom,
  BuiltWorld,
  Connection,
  ConnectionKind,
  DoorData,
  DoorOpening,
  Doorway,
  GeneratedWorld,
  GraphRoom,
  Placement,
  Point,
  Portal,
  PortalData,
  PortalKind,
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
