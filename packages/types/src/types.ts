// World units are metres. Y is up; every room sits on the y = 0 floor.

type Vec3 = readonly [number, number, number];

/** north = -Z edge, south = +Z, east = +X, west = -X. */
type WallSide = "north" | "south" | "east" | "west";

type RoomKind = "room" | "corridor";

type RoomSize = "small" | "medium" | "large";

// ---------------------------------------------------------------------------
// Unit interiors: a graph room laid out in advance as several rooms. The
// cluster frame has x in [0, width] and z in [0, depth]; flow runs along +Z,
// the entry room spans the full width at z = 0 and its north wall is the
// entry port. The layout places the whole rectangle and rotates it.

/** What a room of a unit's interior stands for. */
type FlowRole =
  | "step"
  | "call"
  | "await"
  | "return"
  | "jump"
  | "fork"
  | "merge"
  | "switch"
  | "lane"
  /** A loop's header, at the top of its ring. */
  | "loop-head"
  /** Where a loop asks again: one door to repeat, one to exit. */
  | "loop-test"
  /** The corridor from the test back up to the head. */
  | "loop-back"
  /** Where control leaves a loop. */
  | "loop-end"
  | "collapsed";

type LaneKind =
  "true" | "false" | "case" | "default" | "loop" | "back" | "exit";

/** Which lane a door opens onto; `text` is the lane's own wording (`case "x"`). */
type LaneLabel = {
  readonly kind: LaneKind;
  readonly text?: string;
};

/**
 * A stretch of a cluster's boundary where a door to another unit may go.
 * `lo`/`hi` run along the wall's axis (x for north/south, z for east/west).
 * No `reservedFor`: the entry port, where the cluster is entered from its
 * parent. `portalId`: the portal that stands at this port's centre when no
 * door is made here.
 */
type Port = {
  readonly roomId: string;
  readonly wall: WallSide;
  readonly lo: number;
  readonly hi: number;
  readonly reservedFor?: string;
  readonly portalId?: string;
};

type ClusterRoom = {
  readonly id: string;
  /** In cluster coordinates. */
  readonly rect: Rect;
  readonly role: FlowRole;
  readonly label?: string;
  /** The innermost lane the room lies in, for tints. */
  readonly lane?: LaneLabel;
};

/**
 * How wide an opening is: a door is the standard 1.2 m, a passage (between
 * flow rooms that follow each other without a choice) as wide as the
 * shared edge allows.
 */
type OpeningKind = "passage";

/** A door between two rooms of the same cluster; they share an edge. */
type ClusterDoor = {
  readonly from: string;
  readonly to: string;
  readonly lane?: LaneLabel;
  /** A passage opens as wide as the shared edge allows; absent: a door. */
  readonly opening?: OpeningKind;
};

/**
 * A portal on a cluster room's wall. With `wall` and `along` it is placed
 * already (cluster coordinates); without, the layout finds free wall.
 * `target`: the unit entered for `call`, a room of this cluster for `jump`,
 * absent for `return` (the consumer decides where returns land) and for
 * `marker` (it leads nowhere). A marker is always placed already.
 */
type ClusterPortal = {
  readonly id: string;
  readonly kind: PortalKind;
  readonly roomId: string;
  readonly wall?: WallSide;
  readonly along?: number;
  readonly target?: string;
  readonly label?: string;
};

type RoomCluster = {
  readonly width: number;
  readonly depth: number;
  readonly entryRoomId: string;
  readonly rooms: readonly ClusterRoom[];
  readonly doors: readonly ClusterDoor[];
  readonly ports: readonly Port[];
  readonly portals: readonly ClusterPortal[];
};

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
  /** The interior laid out as several rooms; `width`/`depth` equal its own. */
  readonly cluster?: RoomCluster;
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
 * a plain teleport to `to` that leaves the stack alone. `marker`: a closed
 * frame that cannot be entered, standing for calls the world cannot follow.
 */
type PortalKind = "call" | "return" | "jump" | "marker";

/**
 * A directed jump drawn as a door-like frame on a wall of `from`. Not part of
 * the connectivity the layout places: the wall behind it stays solid.
 */
type Portal = {
  readonly id: string;
  readonly kind: PortalKind;
  /** The room whose wall hosts the portal: a graph room or a cluster room. */
  readonly from: string;
  /**
   * Where it leads: for `call` and `return`, a graph room (a unit lands at
   * its entry), possibly `from`'s own; for `jump`, a room of the same
   * cluster as `from`; for `marker`, `from` itself.
   */
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
  readonly lane?: LaneLabel;
  /**
   * On the side a lane's door was declared from: walking through goes with
   * the flow, into the lane. Both sides carry the lane, for tints.
   */
  readonly forward?: true;
  /** A passage opens as wide as the shared edge allows; absent: a door. */
  readonly opening?: OpeningKind;
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
  readonly role?: FlowRole;
  readonly label?: string;
  /** The innermost lane of its unit the room lies in, for tints. */
  readonly lane?: LaneLabel;
  /** The wall through which this room's unit is entered; the entry room only. */
  readonly entry?: WallSide;
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
  readonly lane?: LaneLabel;
};

/** An axis-aligned box in world space. Lintels span the top of a door opening. */
type WallSegment = {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly kind: "wall" | "lintel";
  /** On a lintel the lane its door opens onto, on a wall the lane its room lies in. */
  readonly lane?: LaneLabel;
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
  readonly lane?: LaneLabel;
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
  ClusterDoor,
  ClusterPortal,
  ClusterRoom,
  Connection,
  ConnectionKind,
  DoorData,
  DoorOpening,
  Doorway,
  FlowRole,
  GeneratedWorld,
  GraphRoom,
  LaneKind,
  LaneLabel,
  Placement,
  Point,
  Port,
  Portal,
  PortalData,
  PortalKind,
  Rect,
  RoomCluster,
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
