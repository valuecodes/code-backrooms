// Mutable placement state for one layout attempt: units (plain rooms and
// clusters) as the rects the search sees, the rooms emitted for them, and
// the doors, corridors and pre-placed portals declared along the way.

import type {
  Connection,
  DoorData,
  FlowRole,
  LaneLabel,
  Port,
  Portal,
  PortalData,
  Rect,
  RoomCluster,
  RoomData,
  RoomKind,
  WallSide,
} from "@repo/types";

import { fullWallPorts, hi, lo, makeRect, OUTWARD } from "./candidates";
import type { Axis, Candidate } from "./candidates";
import {
  CORRIDOR_WIDTH,
  MAX_CORRIDOR_LENGTH,
  MIN_GAP,
  MIN_SHARED,
} from "./config";
import { fit, NONE, sharedEdge, snap } from "./fit";
import type { Placed } from "./fit";
import { OPPOSITE } from "./geometry";
import { connectionKey } from "./graph";
import { orient } from "./units";
import type { Orientation } from "./units";

type PlacedRoom = {
  readonly id: string;
  readonly kind: RoomKind;
  readonly rect: Rect;
  readonly doors: DoorData[];
  readonly connection?: Connection;
  readonly cluster?: string;
  readonly role?: FlowRole;
  readonly label?: string;
  readonly lane?: LaneLabel;
  readonly entry?: WallSide;
};

type UnitMeta = {
  /** World-coordinate ports other units may attach to. */
  readonly ports: readonly Port[];
  /** The room an incoming door lands in. */
  readonly entryRoomId: string;
  readonly cluster: boolean;
  /** The entry port may host an outgoing door: the cluster is the start, with no parent. */
  readonly entryOpen: boolean;
};

/** A unit and the room of it a door is on. */
type Endpoint = {
  readonly unit: string;
  readonly room: string;
};

type Closure =
  | { readonly kind: "door" }
  | { readonly kind: "corridor"; readonly wall: WallSide; readonly rect: Rect };

const WALLS: readonly WallSide[] = ["north", "south", "east", "west"];

const toRoomData = (room: PlacedRoom): RoomData => ({
  id: room.id,
  kind: room.kind,
  position: [
    (room.rect.minX + room.rect.maxX) / 2,
    0,
    (room.rect.minZ + room.rect.maxZ) / 2,
  ],
  width: room.rect.maxX - room.rect.minX,
  depth: room.rect.maxZ - room.rect.minZ,
  doors: room.doors,
  ...(room.connection === undefined ? {} : { connection: room.connection }),
  ...(room.cluster === undefined ? {} : { cluster: room.cluster }),
  ...(room.role === undefined ? {} : { role: room.role }),
  ...(room.label === undefined ? {} : { label: room.label }),
  ...(room.lane === undefined ? {} : { lane: room.lane }),
  ...(room.entry === undefined ? {} : { entry: room.entry }),
});

/**
 * How two placed rects could be joined: a door if they share enough edge,
 * else a straight corridor across the gap if one fits, else nothing.
 */
const findClosure = (
  placed: Placed,
  from: string,
  to: string
): Closure | null => {
  const a = placed.get(from);
  const b = placed.get(to);
  if (a === undefined || b === undefined) {
    return null;
  }
  const edge = sharedEdge(a, b);
  if (edge !== null) {
    return edge.overlap >= MIN_SHARED ? { kind: "door" } : null;
  }
  const touching = new Set([from, to]);
  for (const wall of WALLS) {
    const { axis, sign } = OUTWARD[wall];
    const cross: Axis = axis === "x" ? "z" : "x";
    const gap =
      sign > 0 ? lo(b, axis) - hi(a, axis) : lo(a, axis) - hi(b, axis);
    if (gap < MIN_GAP || gap > MAX_CORRIDOR_LENGTH) {
      continue;
    }
    const crossLo = Math.max(lo(a, cross), lo(b, cross));
    const crossHi = Math.min(hi(a, cross), hi(b, cross)) - CORRIDOR_WIDTH;
    if (crossHi < crossLo) {
      continue;
    }
    const starts = [snap((crossLo + crossHi) / 2)];
    for (let start = crossLo; start <= crossHi; start += 0.5) {
      starts.push(start);
    }
    const [alongLo, alongHi] =
      sign > 0 ? [hi(a, axis), lo(b, axis)] : [hi(b, axis), lo(a, axis)];
    for (const start of starts) {
      const rect = makeRect(
        axis,
        alongLo,
        alongHi,
        start,
        start + CORRIDOR_WIDTH
      );
      if (fit(rect, placed, touching, NONE) !== null) {
        return { kind: "corridor", wall, rect };
      }
    }
  }
  return null;
};

/** Mutable placement state for one layout attempt. */
class Placement {
  /** Every emitted room by its own id, in emission order. */
  readonly rooms = new Map<string, PlacedRoom>();
  /** One rect per unit: what the fit and closure searches see. */
  readonly rects = new Map<string, Rect>();
  readonly units = new Map<string, UnitMeta>();
  readonly resolved = new Set<string>();
  /** Portals clusters placed themselves, in world coordinates. */
  readonly prePlaced: PortalData[] = [];
  private readonly usedPorts = new Set<Port>();
  private corridors = 0;

  /**
   * `reserved`: every id the graph uses (cluster rooms included), so
   * generated ids never shadow one. `portals`: the graph's, which a
   * cluster's pre-placed portals must be among.
   */
  constructor(
    private readonly reserved: ReadonlySet<string>,
    private readonly portals: ReadonlyMap<string, Portal>
  ) {}

  /** `prefix`, suffixed until it is neither a graph id nor placed. */
  freeId(prefix: string): string {
    let id = prefix;
    while (this.reserved.has(id) || this.rects.has(id) || this.rooms.has(id)) {
      id = `${id}-`;
    }
    return id;
  }

  isCluster(unitId: string): boolean {
    return this.units.get(unitId)?.cluster === true;
  }

  /** The unit and the room an incoming door would land in. */
  endpoint(unitId: string): Endpoint {
    return {
      unit: unitId,
      room: this.units.get(unitId)?.entryRoomId ?? unitId,
    };
  }

  /**
   * Ports of `unitId` that `roomId` may hang off: every wall of a plain
   * room; for a cluster, the unused port reserved for `roomId` (and an
   * open entry port). A cluster port hosts one door, so it is retired by
   * `usePort` once chosen.
   */
  portsFor(unitId: string, roomId: string): readonly Port[] {
    const unit = this.units.get(unitId);
    if (unit === undefined) {
      return [];
    }
    return unit.cluster
      ? unit.ports.filter(
          (port) =>
            !this.usedPorts.has(port) &&
            (port.reservedFor === roomId ||
              (port.reservedFor === undefined && unit.entryOpen))
        )
      : unit.ports;
  }

  usePort(port: Port): void {
    this.usedPorts.add(port);
  }

  add(id: string, kind: RoomKind, rect: Rect, connection?: Connection): void {
    this.rects.set(id, rect);
    this.rooms.set(id, { id, kind, rect, doors: [], connection });
    this.units.set(id, {
      ports: fullWallPorts(id, rect),
      entryRoomId: id,
      cluster: false,
      entryOpen: false,
    });
  }

  /**
   * Places a cluster with its bounding box at `rect`, oriented off
   * `orientation`. `entryOpen` lets its entry port host a door out, which
   * only the start unit needs.
   */
  addCluster(
    id: string,
    cluster: RoomCluster,
    orientation: Orientation,
    rect: Rect,
    entryOpen = false
  ): Endpoint {
    const oriented = orient(cluster, orientation, {
      x: rect.minX,
      z: rect.minZ,
    });
    this.rects.set(id, oriented.rect);
    for (const room of oriented.rooms) {
      this.rooms.set(room.id, {
        id: room.id,
        kind: "room",
        rect: room.rect,
        doors: [...room.doors],
        cluster: id,
        role: room.role,
        ...(room.label === undefined ? {} : { label: room.label }),
        ...(room.lane === undefined ? {} : { lane: room.lane }),
        ...(room.entry === undefined ? {} : { entry: room.entry }),
      });
    }
    this.units.set(id, {
      ports: oriented.ports,
      entryRoomId: oriented.entryRoomId,
      cluster: true,
      entryOpen,
    });
    for (const portal of oriented.portals) {
      const graphPortal = this.portals.get(portal.id);
      if (graphPortal === undefined) {
        throw new Error(
          `Cluster "${id}" places portal "${portal.id}", which the graph does not have`
        );
      }
      this.prePlaced.push({
        ...graphPortal,
        wall: portal.wall,
        along: portal.along,
      });
    }
    return { unit: id, room: oriented.entryRoomId };
  }

  /** Declares the door on both sides of a shared edge. */
  connect(fromId: string, wall: WallSide, toId: string): void {
    this.rooms.get(fromId)?.doors.push({ wall, targetRoomId: toId });
    this.rooms
      .get(toId)
      ?.doors.push({ wall: OPPOSITE[wall], targetRoomId: fromId });
  }

  /** A direct door between two units, through the given rooms of theirs. */
  join(from: Endpoint, wall: WallSide, to: Endpoint): void {
    this.connect(from.room, wall, to.room);
    this.resolved.add(connectionKey(from.unit, to.unit));
  }

  door(from: Endpoint, to: Endpoint): void {
    const a = this.rooms.get(from.room)?.rect;
    const b = this.rooms.get(to.room)?.rect;
    const edge = a !== undefined && b !== undefined ? sharedEdge(a, b) : null;
    if (edge === null) {
      throw new Error(
        `Rooms "${from.room}" and "${to.room}" do not share an edge`
      );
    }
    this.join(from, edge.wall, to);
  }

  corridor(from: Endpoint, wall: WallSide, rect: Rect, to: Endpoint): void {
    this.corridors += 1;
    const id = this.freeId(`corridor-${this.corridors}`);
    this.add(id, "corridor", rect, { from: from.unit, to: to.unit });
    this.connect(from.room, wall, id);
    this.connect(id, wall, to.room);
    this.resolved.add(connectionKey(from.unit, to.unit));
  }

  /**
   * Joins two placed units if a door or straight corridor fits. Clusters
   * are never closed to: their doors go through ports chosen up front.
   */
  close(fromId: string, toId: string): boolean {
    if (this.isCluster(fromId) || this.isCluster(toId)) {
      return false;
    }
    const closure = findClosure(this.rects, fromId, toId);
    if (closure === null) {
      return false;
    }
    if (closure.kind === "door") {
      this.door(this.endpoint(fromId), this.endpoint(toId));
    } else {
      this.corridor(
        this.endpoint(fromId),
        closure.wall,
        closure.rect,
        this.endpoint(toId)
      );
    }
    return true;
  }

  /** Placed graph neighbours this candidate could be joined to right away. */
  closable(
    option: Candidate,
    roomId: string,
    neighbours: ReadonlySet<string>
  ): number {
    if (neighbours.size === 0) {
      return 0;
    }
    const preview = new Map(this.rects);
    preview.set(roomId, option.room);
    if (option.corridor !== null) {
      preview.set(this.freeId("preview-corridor"), option.corridor);
    }
    let count = 0;
    for (const id of neighbours) {
      if (findClosure(preview, roomId, id) !== null) {
        count += 1;
      }
    }
    return count;
  }

  /** The rooms emitted so far, as layout data. */
  roomData(): RoomData[] {
    return [...this.rooms.values()].map(toRoomData);
  }
}

export { Placement };
export type { Endpoint };
