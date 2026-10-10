// A function's interior as a cluster: a column of rooms, flow running along
// +Z, forks opening into lanes that rejoin, loops as rings, with ports and
// portals for its calls. Pure and deterministic; the layout rotates and places the result.

import type { ClusterPortal, ClusterRoom, RoomCluster } from "@repo/types";
import { FLOW_TOP_MIN_WIDTH } from "@repo/world-generator/config";

import type { CallSite, FunctionNode } from "./code-graph";
import { foldsOf, foldToBudget } from "./flow-budget";
import { newColumn, placeItems } from "./flow-column";
import type { ColumnRoom } from "./flow-column";
import { labelsOf, markersOf, treeWidth } from "./flow-composite";
import type { FlowTree } from "./flow-composite";
import { jumpsOf, keepJumpTargets } from "./flow-jumps";
import { indexSites } from "./flow-text";
import { measureTree } from "./flow-tree";
import { jumpPortalId, parseFlowNodeId, returnPortalId } from "./ids";

/** A function's interior measured and folded into budget, before placing. */
type FlowPlan = {
  readonly fn: FunctionNode;
  readonly items: readonly FlowTree[];
  /** The cluster's width: at least a plain column, wider for forks. */
  readonly width: number;
  /** Every room's label by id, for the HUD. */
  readonly labels: ReadonlyMap<string, string>;
  /** Rooms with a jump portal, mapped to the room it leads to. */
  readonly jumps: ReadonlyMap<string, string>;
  /** Rooms folded from several, mapped to the last node folded into each. */
  readonly folds: ReadonlyMap<string, string>;
  /** Rooms with a marker, mapped to the calls it stands for (site ids). */
  readonly markers: ReadonlyMap<string, readonly string[]>;
};

/**
 * Measures a function's top-level flow (`sites` are its call sites, any
 * resolution, in source order) and folds it into budget. Depends on the
 * function alone, so every function can be planned before any is placed.
 */
const planFlow = (fn: FunctionNode, sites: readonly CallSite[]): FlowPlan => {
  const index = indexSites(sites, fn.flow);
  const items = keepJumpTargets(
    foldToBudget(measureTree(fn, index), index),
    index
  );
  return {
    fn,
    items,
    width: Math.max(FLOW_TOP_MIN_WIDTH, treeWidth(items)),
    labels: labelsOf(items),
    jumps: jumpsOf(items),
    folds: foldsOf(items),
    markers: markersOf(items),
  };
};

const toClusterRoom = (room: ColumnRoom): ClusterRoom => ({
  id: room.id,
  rect: { minX: room.minX, maxX: room.maxX, minZ: room.minZ, maxZ: room.maxZ },
  role: room.role,
  label: room.label,
  ...(room.lane === undefined ? {} : { lane: room.lane }),
});

const returnPortal = (room: ColumnRoom): ClusterPortal => ({
  id: returnPortalId(room.id),
  kind: "return",
  roomId: room.id,
  wall: "south",
  along: (room.minX + room.maxX) / 2,
  label: "return",
});

/** `continue` into a loop's test room, `break` into an end or merge room. */
const jumpPortal = (room: ColumnRoom, target: string): ClusterPortal => ({
  id: jumpPortalId(room.id),
  kind: "jump",
  roomId: room.id,
  wall: "south",
  along: (room.minX + room.maxX) / 2,
  target,
  label: parseFlowNodeId(target)?.tag === "again" ? "continue" : "break",
});

/**
 * The cluster for one plan. `widthOf` gives a callee's own cluster width,
 * which sets how far apart the ports on one wall must be. A jump portal
 * sits on the south wall of every room that jumps (a `break`, a `continue`,
 * a collapsed room ending in one), leading to a room of the same cluster.
 * A return portal sits on the south wall of every `return` room, of every
 * other collapsed room that ends the flow, and of the last room when the
 * body falls off its end, so a unit can always be left. A room holding
 * calls the world cannot follow has a marker beside its call portals.
 */
const layoutFlow = (
  plan: FlowPlan,
  widthOf: (unitId: string) => number = () => FLOW_TOP_MIN_WIDTH
): RoomCluster => {
  const state = newColumn(plan.width, widthOf);
  const placed = placeItems(plan.items, 0, plan.width, 0, undefined, state);
  const ids = new Set(state.rooms.map((room) => room.id));
  const jumps = state.rooms.flatMap((room) => {
    const target = plan.jumps.get(room.id);
    return target !== undefined && ids.has(target)
      ? [jumpPortal(room, target)]
      : [];
  });
  const jumping = new Set(jumps.map((portal) => portal.roomId));
  const exits = new Set<string>(
    state.rooms
      .filter(
        (room) =>
          !jumping.has(room.id) &&
          (room.role === "return" ||
            (room.role === "collapsed" && room.terminal))
      )
      .map((room) => room.id)
  );
  if (placed.last !== null) {
    exits.add(placed.last);
  }
  const returns = state.rooms
    .filter((room) => exits.has(room.id))
    .map(returnPortal);
  const first = state.rooms[0];
  return {
    width: plan.width,
    depth: placed.bottom,
    entryRoomId: first?.id ?? "",
    rooms: state.rooms.map(toClusterRoom),
    doors: state.doors,
    ports:
      first === undefined
        ? state.ports
        : [
            { roomId: first.id, wall: "north", lo: 0, hi: plan.width },
            ...state.ports,
          ],
    portals: [...state.portals, ...returns, ...jumps],
  };
};

export { layoutFlow, planFlow };
export type { FlowPlan };
