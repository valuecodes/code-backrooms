// Where a room's calls go: ports on the side walls that lie on the cluster
// boundary (another unit can hang off them) and pre-placed portals on any
// wall, with the depth the room must grow to for them.

import type { ClusterPortal, Port, WallSide } from "@repo/types";
import {
  FLOW_CALL_DEPTH,
  FLOW_PORTAL_PITCH,
  GRID,
  MIN_GAP,
  MIN_SHARED,
} from "@repo/world-generator/config";

import { PORTAL_TAIL } from "./flow-measure";
import type { FlowCallee, FlowRoomSpec } from "./flow-measure";
import { callPortalId, markerPortalId } from "./ids";

type Side = "east" | "west";

/** The last port on one cluster wall: where it ended and how wide its callee is. */
type WallTracker = {
  lastHi: number;
  lastWidth: number;
};

type Trackers = Record<Side, WallTracker>;

/**
 * Where the parent unit "ends" on both side walls: it sits above z = 0 and
 * a callee must keep the usual gap from it, so it counts as a port that
 * ended that far before the column starts.
 */
const PARENT_END = -MIN_GAP;

const SIDES: readonly Side[] = ["east", "west"];

const newTrackers = (): Trackers => ({
  east: { lastHi: PARENT_END, lastWidth: 0 },
  west: { lastHi: PARENT_END, lastWidth: 0 },
});

const otherSide = (wall: Side): Side => (wall === "east" ? "west" : "east");

type Hang = {
  readonly callee: FlowCallee;
  readonly wall: Side;
};

type Span = {
  readonly lo: number;
  readonly hi: number;
  /** How much further down the door may sit than for a plain column. */
  readonly reach: number;
};

/**
 * A callee placed against a port may overlap it by only MIN_SHARED, so it
 * can reach `width - MIN_SHARED` past the port's end, and the door is
 * centred on the overlap: up to `width / 2 - MIN_SHARED` past the port's
 * end. That is nothing for a plain 4 m column; a wider callee (a fork, a
 * loop) pushes the portals below the port down by the difference.
 */
const doorReach = (calleeWidth: number): number =>
  Math.max(0, Math.ceil((calleeWidth / 2 - MIN_SHARED) / GRID) * GRID);

type Hung = {
  readonly depth: number;
  readonly ports: readonly Port[];
  readonly portals: readonly ClusterPortal[];
};

/**
 * The callees that get a port, by wall. With both walls free the first
 * callee goes on the wall used least recently and the second on the other;
 * a lone callee is offered both, so a chain of functions can turn either
 * way instead of spiralling (the layout uses one of the two). With one
 * free wall only the first callee gets a port there; with none, nobody.
 */
const portHangs = (
  callees: readonly FlowCallee[],
  free: readonly Side[],
  primary: Side
): readonly Hang[] => {
  const [first] = callees;
  if (first === undefined || free.length === 0) {
    return [];
  }
  if (free.length === 1) {
    return [{ callee: first, wall: free[0] ?? primary }];
  }
  if (callees.length === 1) {
    return [
      { callee: first, wall: primary },
      { callee: first, wall: otherSide(primary) },
    ];
  }
  return callees.slice(0, 2).map((callee, position) => ({
    callee,
    wall: position % 2 === 0 ? primary : otherSide(primary),
  }));
};

/**
 * Hangs a room's callees off its side walls. A port is as short as it can
 * be but ends `max(previous callee's width, this callee's width) + MIN_GAP`
 * past the previous port on its wall, so the room grows when the column is
 * busy on that side. Every other callee gets a pre-placed portal: below the
 * port at FLOW_PORTAL_PITCH on a wall that has one, from the top of the
 * room on a wall that does not, alternating walls. A room with calls the
 * world cannot follow gets one marker after them, placed the same way. A
 * `blocked` side wall holds a fallthrough door, so it gets no portals; with
 * both blocked they go on the south wall, centred (a room walled in like
 * that neither rejoins nor ends, so nothing else is there).
 */
const hangCallees = (
  spec: FlowRoomSpec,
  z: number,
  x0: number,
  x1: number,
  width: number,
  trackers: Trackers,
  widthOf: (unitId: string) => number,
  blocked: ReadonlySet<Side> = new Set()
): Hung => {
  const free = SIDES.filter(
    (side) => !blocked.has(side) && (side === "west" ? x0 === 0 : x1 === width)
  );
  const open = SIDES.filter((side) => !blocked.has(side));
  const primary: Side =
    trackers.west.lastHi < trackers.east.lastHi ? "west" : "east";
  const hangs = portHangs(spec.callees, free, primary);
  // One callee per free wall gets a port; the rest get portals, then the
  // marker takes one more slot.
  const extras = spec.callees.slice(Math.min(spec.callees.length, free.length));
  const slots = extras.length + (spec.markers.length > 0 ? 1 : 0);
  const firstExtraWall: Side =
    free.length === 1 ? (free[0] ?? primary) : primary;
  const extraWall = (position: number): WallSide => {
    const [only] = open;
    if (open.length === 2) {
      return position % 2 === 0 ? firstExtraWall : otherSide(firstExtraWall);
    }
    return only ?? "south";
  };
  const extrasOn = (wall: Side): number => {
    let count = 0;
    for (let position = 0; position < slots; position += 1) {
      count += extraWall(position) === wall ? 1 : 0;
    }
    return count;
  };
  const spans = new Map<Side, Span>();
  let depth = spec.floor;
  for (const { callee, wall } of hangs) {
    const tracker = trackers[wall];
    const pitch = Math.max(tracker.lastWidth, widthOf(callee.unitId)) + MIN_GAP;
    const below = extrasOn(wall);
    // With portals below it the port is FLOW_CALL_DEPTH long and starts
    // where the pitch allows; otherwise it starts at the room and ends
    // where the pitch demands, at least FLOW_CALL_DEPTH long.
    const lo =
      below > 0 ? Math.max(z, tracker.lastHi + pitch - FLOW_CALL_DEPTH) : z;
    const hi =
      below > 0
        ? lo + FLOW_CALL_DEPTH
        : Math.max(lo + FLOW_CALL_DEPTH, tracker.lastHi + pitch);
    const reach = below > 0 ? doorReach(widthOf(callee.unitId)) : 0;
    spans.set(wall, { lo, hi, reach });
    depth = Math.max(
      depth,
      hi - z + (below > 0 ? reach + below * FLOW_PORTAL_PITCH + PORTAL_TAIL : 0)
    );
  }
  for (const wall of SIDES) {
    const count = extrasOn(wall);
    if (count > 0 && !spans.has(wall)) {
      depth = Math.max(
        depth,
        PORTAL_TAIL + (count - 1) * FLOW_PORTAL_PITCH + PORTAL_TAIL
      );
    }
  }
  const ports: Port[] = [];
  for (const { callee, wall } of hangs) {
    const span = spans.get(wall);
    if (span === undefined) {
      continue;
    }
    ports.push({
      roomId: spec.id,
      wall,
      lo: span.lo,
      hi: span.hi,
      reservedFor: callee.unitId,
      portalId: callPortalId(callee.siteId),
    });
    trackers[wall].lastHi = span.hi;
    trackers[wall].lastWidth = widthOf(callee.unitId);
  }
  const portals: ClusterPortal[] = [];
  const placedOn: Record<WallSide, number> = {
    north: 0,
    south: 0,
    east: 0,
    west: 0,
  };
  // South-wall portals are centred on the room, FLOW_PORTAL_PITCH apart.
  const southFirst = (x0 + x1) / 2 - ((slots - 1) * FLOW_PORTAL_PITCH) / 2;
  for (let position = 0; position < slots; position += 1) {
    const wall = extraWall(position);
    const span = wall === "east" || wall === "west" ? spans.get(wall) : null;
    let along: number;
    if (wall === "south") {
      along = southFirst + FLOW_PORTAL_PITCH * placedOn[wall];
    } else if (span === undefined || span === null) {
      along = z + PORTAL_TAIL + FLOW_PORTAL_PITCH * placedOn[wall];
    } else {
      along = span.hi + span.reach + FLOW_PORTAL_PITCH * (placedOn[wall] + 1);
    }
    placedOn[wall] += 1;
    const callee = extras[position];
    portals.push(
      callee === undefined
        ? {
            id: markerPortalId(spec.id),
            kind: "marker",
            roomId: spec.id,
            wall,
            along,
            label: `${spec.markers.length} call${spec.markers.length === 1 ? "" : "s"}`,
          }
        : {
            id: callPortalId(callee.siteId),
            kind: "call",
            roomId: spec.id,
            wall,
            along,
            target: callee.unitId,
          }
    );
  }
  return { depth, ports, portals };
};

export { hangCallees, newTrackers };
export type { Side, Trackers };
