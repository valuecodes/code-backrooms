// Places a tree of rooms in a column: rooms stack from the top, a fork puts
// its head across the column, its lanes side by side below it and its merge
// room across again, each lane a column of its own. Lanes are stretched to
// the deepest one so the rooms tile the rectangle; a case that falls through
// has a door from its last room into the next lane's first. A loop is a
// ring: head across, body beside a back corridor, test across, end across.

import type { ClusterDoor, ClusterPortal, LaneLabel, Port } from "@repo/types";
import {
  FLOW_LANE_WIDTH,
  GRID,
  MIN_SHARED,
} from "@repo/world-generator/config";

import { BACK_LANE, BODY_LANE, EXIT_LANE, laneWidth } from "./flow-composite";
import type { FlowTree, ForkSpec, LaneSpec, LoopSpec } from "./flow-composite";
import { hangCallees, newTrackers } from "./flow-hang";
import type { Side, Trackers } from "./flow-hang";
import type { FlowRoomSpec } from "./flow-measure";

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

/** Side walls a sequence's first and last rooms keep free for fallthrough doors. */
type Edges = {
  readonly first: ReadonlySet<Side>;
  readonly last: ReadonlySet<Side>;
};

const NO_SIDES: ReadonlySet<Side> = new Set();
const NO_EDGES: Edges = { first: NO_SIDES, last: NO_SIDES };

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
  state: ColumnState,
  blocked: ReadonlySet<Side> = NO_SIDES
): ColumnRoom => {
  const hung = hangCallees(
    spec,
    z,
    x0,
    x1,
    state.width,
    state.trackers,
    state.widthOf,
    blocked
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

/** A room at least `depth` deep: the room itself, or a composite's head. */
const deepened = (item: FlowTree, depth: number): FlowTree => {
  const grow = (spec: FlowRoomSpec): FlowRoomSpec =>
    spec.floor >= depth
      ? spec
      : { ...spec, floor: depth, depth: Math.max(spec.depth, depth) };
  return item.kind === "room" ? grow(item) : { ...item, head: grow(item.head) };
};

/**
 * The body of a lane fallen into, its first room deep enough to share
 * MIN_SHARED of its west wall with the last room of the lane before, which
 * starts at `from` and is stretched to the bottom of the fork.
 */
const reaching = (
  body: readonly FlowTree[],
  top: number,
  from: number
): readonly FlowTree[] => {
  const [first, ...rest] = body;
  const depth = from + MIN_SHARED - top;
  return first === undefined || depth <= 0
    ? body
    : [deepened(first, depth), ...rest];
};

/** The side walls a lane's rooms keep free for the doors of its fallthroughs. */
const laneEdges = (lane: LaneSpec): Edges => ({
  first: lane.fallenInto ? new Set<Side>(["west"]) : NO_SIDES,
  last: lane.fallsThrough ? new Set<Side>(["east"]) : NO_SIDES,
});

const placeFork = (
  fork: ForkSpec,
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState,
  blocked: ReadonlySet<Side> = NO_SIDES
): Placed => {
  const head = placeRoom(fork.head, x0, x1, z, lane, state, blocked);
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
  // The last room of a lane that falls through, for the next lane's door.
  let falling: ColumnRoom | undefined;
  for (const [index, item] of fork.lanes.entries()) {
    const width = widths[index] ?? 0;
    const from = state.rooms.length;
    const body =
      item.fallenInto && falling !== undefined
        ? reaching(item.body, top, falling.minZ)
        : item.body;
    const placed = placeItems(
      body,
      x,
      x + width,
      top,
      item.label,
      state,
      laneEdges(item)
    );
    if (placed.first !== null) {
      state.doors.push({ from: head.id, to: placed.first, lane: item.label });
      if (item.fallenInto && falling !== undefined) {
        state.doors.push({
          from: falling.id,
          to: placed.first,
          lane: item.label,
        });
      }
    }
    falling = item.fallsThrough
      ? state.rooms.find((room) => room.id === placed.last)
      : undefined;
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

/**
 * A loop's ring: the head across the column, the body down the west side
 * beside the back corridor (one lane wide, as deep as the body), the test
 * across below both with a door into the corridor and one into the end
 * room, and the corridor's top door back into the head.
 */
const placeLoop = (
  loop: LoopSpec,
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState,
  blocked: ReadonlySet<Side> = NO_SIDES
): Placed => {
  const head = placeRoom(loop.head, x0, x1, z, lane, state, blocked);
  const split = x1 - FLOW_LANE_WIDTH;
  const body = placeItems(loop.body, x0, split, head.maxZ, BODY_LANE, state);
  if (body.first !== null) {
    state.doors.push({ from: head.id, to: body.first, lane: BODY_LANE });
  }
  // No calls, so the corridor needs no hanging: one room beside the body.
  const back: ColumnRoom = {
    id: loop.back.id,
    role: loop.back.role,
    label: loop.back.label,
    lane: BACK_LANE,
    terminal: false,
    minX: split,
    maxX: x1,
    minZ: head.maxZ,
    maxZ: body.bottom,
  };
  state.rooms.push(back);
  const test = placeRoom(loop.test, x0, x1, body.bottom, lane, state);
  if (body.last !== null) {
    state.doors.push({ from: body.last, to: test.id });
  }
  state.doors.push(
    { from: test.id, to: back.id, lane: BACK_LANE },
    { from: back.id, to: head.id }
  );
  const end = placeRoom(loop.end, x0, x1, test.maxZ, lane, state);
  state.doors.push({ from: test.id, to: end.id, lane: EXIT_LANE });
  return { first: head.id, last: end.id, bottom: end.maxZ };
};

/**
 * Stacks the items from `z` between `x0` and `x1`, a door between
 * neighbours. `edges` names the side walls the first room (a composite's
 * head) and the last room keep free for fallthrough doors; a composite's
 * last room is a merge or end room, which has no calls.
 */
const placeItems = (
  items: readonly FlowTree[],
  x0: number,
  x1: number,
  z: number,
  lane: LaneLabel | undefined,
  state: ColumnState,
  edges: Edges = NO_EDGES
): Placed => {
  let first: string | null = null;
  let last: string | null = null;
  let bottom = z;
  for (const [index, item] of items.entries()) {
    const blocked = new Set<Side>([
      ...(index === 0 ? edges.first : []),
      ...(index === items.length - 1 && item.kind === "room" ? edges.last : []),
    ]);
    if (last !== null) {
      state.doors.push({
        from: last,
        to: item.kind === "room" ? item.id : item.head.id,
      });
    }
    let placed: Placed;
    if (item.kind === "fork") {
      placed = placeFork(item, x0, x1, bottom, lane, state, blocked);
    } else if (item.kind === "loop") {
      placed = placeLoop(item, x0, x1, bottom, lane, state, blocked);
    } else {
      const room = placeRoom(item, x0, x1, bottom, lane, state, blocked);
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
