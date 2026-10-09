// A function's interior as a cluster: a column of rooms, one per top-level
// flow node, flow running along +Z, with ports and portals for its calls.
// Pure and deterministic; the layout rotates and places the result.

import type {
  ClusterDoor,
  ClusterPortal,
  ClusterRoom,
  Port,
  RoomCluster,
} from "@repo/types";
import {
  FLOW_CALL_DEPTH,
  FLOW_LANE_WIDTH,
  FLOW_PORTAL_PITCH,
  FLOW_TOP_MIN_WIDTH,
  MIN_GAP,
} from "@repo/world-generator/config";

import type { CallSite, FunctionNode } from "./code-graph";
import { foldToBudget } from "./flow-budget";
import { measureBody, PORT_PITCH } from "./flow-measure";
import type { FlowCallee, FlowRoomSpec } from "./flow-measure";
import { callPortalId, returnPortalId } from "./ids";

/** Past the last portal on a wall: its half frame plus clearance from the corner. */
const PORTAL_TAIL = 1.5;

/**
 * Where the parent unit "ends" on both side walls: it sits above z = 0 and
 * a callee must keep the usual gap from it, so it counts as a port that
 * ended that far before the column starts.
 */
const PARENT_END = -MIN_GAP;

type Side = "east" | "west";

type Column = {
  readonly rooms: readonly ClusterRoom[];
  readonly doors: readonly ClusterDoor[];
  readonly ports: readonly Port[];
  readonly portals: readonly ClusterPortal[];
};

const otherSide = (wall: Side): Side => (wall === "east" ? "west" : "east");

/** Where a room's first two callees go and where its extras go, by position. */
const sideOf = (primary: Side, position: number): Side =>
  position % 2 === 0 ? primary : otherSide(primary);

/**
 * Stacks the rooms from z = 0, each the full width, a door between
 * neighbours, and hangs the calls on the side walls as it goes. A room's
 * first callee gets a port on the side wall used least recently, its second
 * the other wall; later callees get a portal each, pre-placed below the
 * port at FLOW_PORTAL_PITCH, alternating walls. A port is as short as it
 * can be but ends PORT_PITCH past the previous port on its wall, so the
 * room grows when the column is busy on that side. The parent unit sits
 * above z = 0 and counts as a port that ended MIN_GAP before it.
 */
const placeRooms = (specs: readonly FlowRoomSpec[], width: number): Column => {
  const rooms: ClusterRoom[] = [];
  const doors: ClusterDoor[] = [];
  const ports: Port[] = [];
  const portals: ClusterPortal[] = [];
  const lastHi: Record<Side, number> = { east: PARENT_END, west: PARENT_END };
  let z = 0;
  for (const spec of specs) {
    const primary: Side = lastHi.west < lastHi.east ? "west" : "east";
    // A lone callee is offered both walls, so a chain of functions can turn
    // either way instead of spiralling; the layout uses one of the two.
    const hangs: readonly {
      readonly callee: FlowCallee;
      readonly wall: Side;
    }[] =
      spec.callees.length === 1 && spec.callees[0] !== undefined
        ? [
            { callee: spec.callees[0], wall: primary },
            { callee: spec.callees[0], wall: otherSide(primary) },
          ]
        : spec.callees.slice(0, 2).map((callee, position) => ({
            callee,
            wall: sideOf(primary, position),
          }));
    const extras = spec.callees.slice(2);
    const extrasOn = (wall: Side): number =>
      extras.filter((_, position) => sideOf(primary, position) === wall).length;
    const spans = new Map<Side, { readonly lo: number; readonly hi: number }>();
    let depth = spec.depth;
    for (const { wall } of hangs) {
      const below = extrasOn(wall);
      // With portals below it the port is FLOW_CALL_DEPTH long and starts
      // where the pitch allows; otherwise it starts at the room and ends
      // where the pitch demands, at least FLOW_CALL_DEPTH long.
      const lo =
        below > 0
          ? Math.max(z, lastHi[wall] + PORT_PITCH - FLOW_CALL_DEPTH)
          : z;
      const hi =
        below > 0
          ? lo + FLOW_CALL_DEPTH
          : Math.max(lo + FLOW_CALL_DEPTH, lastHi[wall] + PORT_PITCH);
      spans.set(wall, { lo, hi });
      depth = Math.max(
        depth,
        hi - z + (below > 0 ? below * FLOW_PORTAL_PITCH + PORTAL_TAIL : 0)
      );
    }
    const maxZ = z + depth;
    const previous = rooms.at(-1);
    if (previous !== undefined) {
      doors.push({ from: previous.id, to: spec.id });
    }
    rooms.push({
      id: spec.id,
      rect: { minX: 0, maxX: width, minZ: z, maxZ },
      role: spec.role,
      label: spec.label,
    });
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
      lastHi[wall] = span.hi;
    }
    for (const [position, callee] of extras.entries()) {
      const wall = sideOf(primary, position);
      portals.push({
        id: callPortalId(callee.siteId),
        kind: "call",
        roomId: spec.id,
        wall,
        along:
          (spans.get(wall)?.hi ?? z) +
          FLOW_PORTAL_PITCH * (Math.floor(position / 2) + 1),
        target: callee.unitId,
      });
    }
    z = maxZ;
  }
  const first = rooms[0];
  return {
    rooms,
    doors,
    ports:
      first === undefined
        ? ports
        : [{ roomId: first.id, wall: "north", lo: 0, hi: width }, ...ports],
    portals,
  };
};

/**
 * The cluster for one function: measure its top-level flow, fold it into
 * budget, stack the rooms with their ports and portals, and put the return
 * portal on the last room's south wall, whether the function ends in a
 * `return` or falls off the end.
 */
const layoutFlow = (
  fn: FunctionNode,
  sites: readonly CallSite[]
): RoomCluster => {
  const width = Math.max(FLOW_TOP_MIN_WIDTH, FLOW_LANE_WIDTH);
  const specs = foldToBudget(measureBody(fn, sites));
  const { rooms, doors, ports, portals } = placeRooms(specs, width);
  const last = rooms.at(-1);
  const exit: ClusterPortal[] =
    last === undefined
      ? []
      : [
          {
            id: returnPortalId(last.id),
            kind: "return",
            roomId: last.id,
            wall: "south",
            along: width / 2,
            label: "return",
          },
        ];
  return {
    width,
    depth: last?.rect.maxZ ?? 0,
    entryRoomId: rooms[0]?.id ?? "",
    rooms,
    doors,
    ports,
    portals: [...portals, ...exit],
  };
};

export { layoutFlow };
