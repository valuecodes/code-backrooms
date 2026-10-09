// Places a tree of rooms in a column: rooms stack from the top, a fork puts
// its head across the column, its lanes side by side below it and its merge
// room across again, each lane a column of its own. Lanes are stretched to
// the deepest one so the rooms tile the rectangle.

import type { ClusterDoor, ClusterPortal, LaneLabel, Port } from "@repo/types";
import { GRID } from "@repo/world-generator/config";

import { hangCallees, newTrackers } from "./flow-hang";
import type { Trackers } from "./flow-hang";
import type { FlowRoomSpec } from "./flow-measure";
import { laneWidth } from "./flow-tree";
import type { FlowTree, ForkSpec, LaneSpec } from "./flow-tree";

/** A room while the column is built: its rect may still be stretched. */
type ColumnRoom = {
  readonly id: string;
  readonly role: FlowRoomSpec["role"];
  readonly label: string;
  readonly lane: LaneLabel | undefined;
  readonly terminal: boolean;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  maxZ: number;
};

type ColumnState = {
  readonly width: number;
  readonly widthOf: (unitId: string) => number;
  readonly trackers: Trackers;
  readonly rooms: ColumnRoom[];
  readonly doors: ClusterDoor[];
  readonly ports: Port[];
  readonly portals: ClusterPortal[];
};

/** What a placed sequence offers its neighbours: a room to enter, one to leave. */
type Placed = {
  readonly first: string | null;
  /** Null when control cannot run out of the end. */
  readonly last: string | null;
  readonly bottom: number;
};

const newColumn = (
  width: number,
  widthOf: (unitId: string) => number
): ColumnState => ({
  width,
  widthOf,
  trackers: newTrackers(),
  rooms: [],
  doors: [],
  ports: [],
  portals: [],
});

const placeRoom = (
  spec: FlowRoomSpec,
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState
): ColumnRoom => {
  const hung = hangCallees(
    spec,
    z,
    x0,
    x1,
    state.width,
    state.trackers,
    state.widthOf
  );
  const room: ColumnRoom = {
    id: spec.id,
    role: spec.role,
    label: spec.label,
    lane,
    terminal: spec.terminal,
    minX: x0,
    maxX: x1,
    minZ: z,
    maxZ: z + hung.depth,
  };
  state.rooms.push(room);
  state.ports.push(...hung.ports);
  state.portals.push(...hung.portals);
  return room;
};

/**
 * Each lane's natural width plus an equal share of the slack, floored to
 * the grid; the last lane takes the remainder so the widths sum exactly.
 */
const laneWidths = (
  lanes: readonly LaneSpec[],
  total: number
): readonly number[] => {
  const natural = lanes.map(laneWidth);
  const slack = total - natural.reduce((sum, width) => sum + width, 0);
  const share = Math.floor(slack / lanes.length / GRID) * GRID;
  const widths = natural.map((width) => width + share);
  const used = widths.reduce((sum, width) => sum + width, 0);
  const last = widths.length - 1;
  return widths.map((width, index) =>
    index === last ? width + total - used : width
  );
};

const placeFork = (
  fork: ForkSpec,
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState
): Placed => {
  const head = placeRoom(fork.head, x0, x1, z, lane, state);
  const top = head.maxZ;
  const widths = laneWidths(fork.lanes, x1 - x0);
  const ends: {
    readonly lane: LaneSpec;
    readonly placed: Placed;
    readonly from: number;
    readonly to: number;
  }[] = [];
  let x = x0;
  let bottom = top;
  for (const [index, item] of fork.lanes.entries()) {
    const width = widths[index] ?? 0;
    const from = state.rooms.length;
    const placed = placeItems(item.body, x, x + width, top, item.label, state);
    if (placed.first !== null) {
      state.doors.push({ from: head.id, to: placed.first, lane: item.label });
    }
    ends.push({ lane: item, placed, from, to: state.rooms.length });
    bottom = Math.max(bottom, placed.bottom);
    x += width;
  }
  // Stretch every room on a lane's bottom edge down to the deepest lane.
  for (const end of ends) {
    for (const room of state.rooms.slice(end.from, end.to)) {
      if (room.maxZ === end.placed.bottom) {
        room.maxZ = bottom;
      }
    }
  }
  if (fork.merge === null) {
    return { first: head.id, last: null, bottom };
  }
  const merge = placeRoom(fork.merge, x0, x1, bottom, lane, state);
  for (const end of ends) {
    if (end.lane.rejoins && end.placed.last !== null) {
      state.doors.push({ from: end.placed.last, to: merge.id });
    }
  }
  return { first: head.id, last: merge.id, bottom: merge.maxZ };
};

/** Stacks the items from `z` between `x0` and `x1`, a door between neighbours. */
const placeItems = (
  items: readonly FlowTree[],
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState
): Placed => {
  let first: string | null = null;
  let last: string | null = null;
  let bottom = z;
  for (const item of items) {
    if (last !== null) {
      state.doors.push({
        from: last,
        to: item.kind === "fork" ? item.head.id : item.id,
      });
    }
    let placed: Placed;
    if (item.kind === "fork") {
      placed = placeFork(item, x0, x1, bottom, lane, state);
    } else {
      const room = placeRoom(item, x0, x1, bottom, lane, state);
      placed = {
        first: room.id,
        last: item.terminal ? null : room.id,
        bottom: room.maxZ,
      };
    }
    first ??= placed.first;
    last = placed.last;
    bottom = placed.bottom;
  }
  return { first, last, bottom };
};

export { newColumn, placeItems };
export type { ColumnRoom };
