// A cluster turned into world rooms: rotated so its entry faces the anchor,
// then translated. One point map drives rects, ports and portals alike.

import type {
  DoorData,
  FlowRole,
  LaneLabel,
  Point,
  Port,
  Rect,
  RoomCluster,
  WallSide,
} from "@repo/types";

import type { Extent } from "./candidates";
import { sharedEdge } from "./fit";
import { OPPOSITE, wallAxis } from "./geometry";

/**
 * Named by the anchor wall the cluster hangs off, which is also the world
 * direction its flow runs: off a south wall the flow runs +Z (the template
 * as drawn), off a north wall −Z, off an east wall +X, off a west wall −X.
 */
type Orientation = WallSide;

type OrientedRoom = {
  readonly id: string;
  readonly rect: Rect;
  readonly role: FlowRole;
  readonly label?: string;
  readonly lane?: LaneLabel;
  /** Set on the entry room: the wall the unit is entered through. */
  readonly entry?: WallSide;
  /** Doors to the other rooms of the cluster, both sides declared. */
  readonly doors: readonly DoorData[];
};

type OrientedPortal = {
  readonly id: string;
  readonly roomId: string;
  readonly wall: WallSide;
  readonly along: number;
};

type OrientedCluster = {
  /** The cluster's bounding box in the world. */
  readonly rect: Rect;
  readonly rooms: readonly OrientedRoom[];
  /** In world coordinates, the entry port included. */
  readonly ports: readonly Port[];
  /** The portals the cluster placed itself, in world coordinates. */
  readonly portals: readonly OrientedPortal[];
  readonly entryRoomId: string;
};

/** Which world wall each cluster-frame wall becomes. */
const WALL_MAP: Record<Orientation, Record<WallSide, WallSide>> = {
  south: { north: "north", south: "south", east: "east", west: "west" },
  north: { north: "south", south: "north", east: "west", west: "east" },
  east: { north: "west", south: "east", east: "north", west: "south" },
  west: { north: "east", south: "west", east: "south", west: "north" },
};

/** A cluster-frame point in the world, before translation. */
const rotate = (
  cluster: RoomCluster,
  orientation: Orientation,
  point: Point
): Point => {
  const { width, depth } = cluster;
  switch (orientation) {
    case "north": {
      return { x: width - point.x, z: depth - point.z };
    }
    case "east": {
      return { x: point.z, z: width - point.x };
    }
    case "west": {
      return { x: depth - point.z, z: point.x };
    }
    case "south":
    default: {
      return point;
    }
  }
};

const mapPoint = (
  cluster: RoomCluster,
  orientation: Orientation,
  origin: Point,
  point: Point
): Point => {
  const rotated = rotate(cluster, orientation, point);
  return { x: rotated.x + origin.x, z: rotated.z + origin.z };
};

const mapRect = (
  cluster: RoomCluster,
  orientation: Orientation,
  origin: Point,
  rect: Rect
): Rect => {
  const a = mapPoint(cluster, orientation, origin, {
    x: rect.minX,
    z: rect.minZ,
  });
  const b = mapPoint(cluster, orientation, origin, {
    x: rect.maxX,
    z: rect.maxZ,
  });
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
};

/** A point on the cluster boundary at `along` on the given wall's axis. */
const wallPoint = (
  cluster: RoomCluster,
  wall: WallSide,
  along: number
): Point => {
  switch (wall) {
    case "north": {
      return { x: along, z: 0 };
    }
    case "south": {
      return { x: along, z: cluster.depth };
    }
    case "east": {
      return { x: cluster.width, z: along };
    }
    case "west":
    default: {
      return { x: 0, z: along };
    }
  }
};

const alongOf = (wall: WallSide, point: Point): number =>
  wallAxis(wall) === "x" ? point.x : point.z;

/** A wall and a stretch of it (or one position) in the world. */
const mapSpan = (
  cluster: RoomCluster,
  orientation: Orientation,
  origin: Point,
  wall: WallSide,
  lo: number,
  hi: number
): { readonly wall: WallSide; readonly lo: number; readonly hi: number } => {
  const worldWall = WALL_MAP[orientation][wall];
  const a = alongOf(
    worldWall,
    mapPoint(cluster, orientation, origin, wallPoint(cluster, wall, lo))
  );
  const b = alongOf(
    worldWall,
    mapPoint(cluster, orientation, origin, wallPoint(cluster, wall, hi))
  );
  return { wall: worldWall, lo: Math.min(a, b), hi: Math.max(a, b) };
};

/**
 * The cluster in the world: rotated by `orientation`, its bounding box's
 * minimum corner at `origin`. Doors are derived from the world rects, so a
 * template door between rooms that do not share an edge throws.
 */
const orient = (
  cluster: RoomCluster,
  orientation: Orientation,
  origin: Point
): OrientedCluster => {
  const rects = new Map(
    cluster.rooms.map((room) => [
      room.id,
      mapRect(cluster, orientation, origin, room.rect),
    ])
  );
  const doors = new Map<string, DoorData[]>(
    cluster.rooms.map((room) => [room.id, []])
  );
  for (const door of cluster.doors) {
    const a = rects.get(door.from);
    const b = rects.get(door.to);
    const edge = a === undefined || b === undefined ? null : sharedEdge(a, b);
    if (edge === null) {
      throw new Error(
        `Cluster rooms "${door.from}" and "${door.to}" do not share an edge`
      );
    }
    const lane = door.lane === undefined ? {} : { lane: door.lane };
    doors.get(door.from)?.push({
      wall: edge.wall,
      targetRoomId: door.to,
      ...(door.lane === undefined ? {} : { lane: door.lane, forward: true }),
    });
    doors.get(door.to)?.push({
      wall: OPPOSITE[edge.wall],
      targetRoomId: door.from,
      ...lane,
    });
  }
  const entryWall = OPPOSITE[orientation];
  const rooms = cluster.rooms.map((room): OrientedRoom => ({
    id: room.id,
    rect: rects.get(room.id) ?? room.rect,
    role: room.role,
    ...(room.label === undefined ? {} : { label: room.label }),
    ...(room.lane === undefined ? {} : { lane: room.lane }),
    ...(room.id === cluster.entryRoomId ? { entry: entryWall } : {}),
    doors: doors.get(room.id) ?? [],
  }));
  const ports = cluster.ports.map((port): Port => ({
    ...port,
    ...mapSpan(cluster, orientation, origin, port.wall, port.lo, port.hi),
  }));
  const portals = cluster.portals.flatMap((portal): OrientedPortal[] => {
    if (portal.wall === undefined || portal.along === undefined) {
      return [];
    }
    const span = mapSpan(
      cluster,
      orientation,
      origin,
      portal.wall,
      portal.along,
      portal.along
    );
    return [
      { id: portal.id, roomId: portal.roomId, wall: span.wall, along: span.lo },
    ];
  });
  return {
    rect: mapRect(cluster, orientation, origin, {
      minX: 0,
      maxX: cluster.width,
      minZ: 0,
      maxZ: cluster.depth,
    }),
    rooms,
    ports,
    portals,
    entryRoomId: cluster.entryRoomId,
  };
};

/** The extent a cluster occupies when hung off `wall`: rotated for east/west. */
const footprintOf = (cluster: RoomCluster, wall: WallSide): Extent =>
  wall === "north" || wall === "south"
    ? { width: cluster.width, depth: cluster.depth }
    : { width: cluster.depth, depth: cluster.width };

export { footprintOf, orient };
export type { Orientation };
