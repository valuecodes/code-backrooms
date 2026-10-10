// The shapes of a function's interior before it is placed: a tree of rooms
// in which a branch or switch is a fork (head, lanes, merge) and a loop a
// ring (head, body, test, back corridor, end). Widths, room counts, depth
// estimates and labels come from the tree bottom-up; the budget and the
// placer walk composites through `bodiesOf` and `withBodies`.

import type { LaneLabel } from "@repo/types";
import {
  DOOR_WIDTH,
  FLOW_LANE_WIDTH,
  FLOW_PORTAL_PITCH,
  GRID,
  MIN_SHARED,
  PORTAL_GAP,
  WALL_THICKNESS,
} from "@repo/world-generator/config";

import type { BranchNode, LoopNode, SwitchNode } from "./code-graph";
import { PORT_PITCH } from "./flow-measure";
import type { FlowRoomSpec } from "./flow-measure";

/** One way through a fork: a sub-column of rooms. */
type LaneSpec = {
  /** The lane's sequence node, or the synthesised `default` of a switch. */
  readonly id: string;
  readonly label: LaneLabel;
  readonly body: readonly FlowTree[];
  /** Control may run out of the lane's end into the merge room. */
  readonly rejoins: boolean;
  /** A case that runs on into the next lane: its last room has a door there. */
  readonly fallsThrough: boolean;
  /** The lane before falls through into this one's first room. */
  readonly fallenInto: boolean;
};

type ForkSpec = {
  readonly kind: "fork";
  readonly node: BranchNode | SwitchNode;
  readonly head: FlowRoomSpec;
  readonly lanes: readonly LaneSpec[];
  /** Null when no lane rejoins: nothing runs past the fork. */
  readonly merge: FlowRoomSpec | null;
};

/**
 * A loop as a ring: the head across the top, the body down the west side,
 * the test across the bottom with a door back up the east-side corridor to
 * the head and a door out into the end room.
 */
type LoopSpec = {
  readonly kind: "loop";
  readonly node: LoopNode;
  readonly head: FlowRoomSpec;
  readonly body: readonly FlowTree[];
  readonly test: FlowRoomSpec;
  readonly back: FlowRoomSpec;
  readonly end: FlowRoomSpec;
};

type CompositeSpec = ForkSpec | LoopSpec;

type FlowTree = FlowRoomSpec | CompositeSpec;

/** The lane a loop's body lies in, and those of the doors out of its test. */
const BODY_LANE: LaneLabel = { kind: "loop", text: "body" };
const BACK_LANE: LaneLabel = { kind: "back", text: "repeat" };
const EXIT_LANE: LaneLabel = { kind: "exit" };

/** The sequences one level down: a fork's lanes, a loop's body. */
const bodiesOf = (item: CompositeSpec): readonly (readonly FlowTree[])[] =>
  item.kind === "fork" ? item.lanes.map((lane) => lane.body) : [item.body];

/** The composite with each of its bodies replaced by `map` of it. */
const withBodies = (
  item: CompositeSpec,
  map: (body: readonly FlowTree[]) => readonly FlowTree[]
): CompositeSpec =>
  item.kind === "fork"
    ? {
        ...item,
        lanes: item.lanes.map((lane) => ({ ...lane, body: map(lane.body) })),
      }
    : { ...item, body: map(item.body) };

/** The rooms a composite adds around its bodies. */
const ownRooms = (item: CompositeSpec): readonly FlowRoomSpec[] => {
  if (item.kind === "loop") {
    return [item.head, item.back, item.test, item.end];
  }
  return item.merge === null ? [item.head] : [item.head, item.merge];
};

/** The width a sub-column needs: at least one lane, or what it holds needs. */
const bodyWidth = (body: readonly FlowTree[]): number =>
  Math.max(FLOW_LANE_WIDTH, treeWidth(body));

/**
 * The one room of a lane with a fallthrough door on both side walls: the
 * lane before falls into it and it falls into the next. Its calls (and its
 * marker) can only be portals on its south wall.
 */
const boxedRoom = (lane: LaneSpec): FlowRoomSpec | null => {
  const [only] = lane.body;
  return lane.fallsThrough &&
    lane.fallenInto &&
    lane.body.length === 1 &&
    only?.kind === "room"
    ? only
    : null;
};

/** Centre of a portal to the corner of its wall: half a frame, the wall, a gap. */
const PORTAL_MARGIN = DOOR_WIDTH / 2 + WALL_THICKNESS + PORTAL_GAP;

/** The width a south wall needs for `count` portals FLOW_PORTAL_PITCH apart. */
const southWidth = (count: number): number =>
  count === 0
    ? 0
    : Math.ceil(
        (2 * PORTAL_MARGIN + (count - 1) * FLOW_PORTAL_PITCH) / GRID - 1e-9
      ) * GRID;

/** The portals on a room's walls: one per callee beyond its ports, a marker. */
const portalSlots = (room: FlowRoomSpec): number =>
  room.callees.length + (room.markers.length > 0 ? 1 : 0);

const laneWidth = (lane: LaneSpec): number => {
  const boxed = boxedRoom(lane);
  return Math.max(
    bodyWidth(lane.body),
    southWidth(boxed === null ? 0 : portalSlots(boxed))
  );
};

/** A fork's lanes side by side; a loop's body beside its back corridor. */
const compositeWidth = (item: CompositeSpec): number =>
  item.kind === "fork"
    ? item.lanes.reduce((sum, lane) => sum + laneWidth(lane), 0)
    : bodyWidth(item.body) + FLOW_LANE_WIDTH;

/** The width a sequence needs: its widest composite; rooms take the column's. */
const treeWidth = (items: readonly FlowTree[]): number =>
  items.reduce(
    (width, item) =>
      item.kind === "room" ? width : Math.max(width, compositeWidth(item)),
    0
  );

const roomCount = (items: readonly FlowTree[]): number =>
  items.reduce(
    (count, item) =>
      count +
      (item.kind === "room"
        ? 1
        : ownRooms(item).length +
          bodiesOf(item).reduce((sum, body) => sum + roomCount(body), 0)),
    0
  );

/** A room with calls may be grown to the port pitch when placed; budget for it. */
const placedDepth = (spec: FlowRoomSpec): number =>
  spec.callees.length > 0 ? Math.max(spec.depth, PORT_PITCH) : spec.depth;

/** The depth of a sequence's first room: a room, or a composite's head. */
const firstDepth = (body: readonly FlowTree[]): number => {
  const [first] = body;
  if (first === undefined) {
    return 0;
  }
  return placedDepth(first.kind === "room" ? first : first.head);
};

/** The depth of a sequence's last room: a room, a merge or a loop's end. */
const lastDepth = (body: readonly FlowTree[]): number => {
  const last = body.at(-1);
  switch (last?.kind) {
    case "room": {
      return placedDepth(last);
    }
    case "fork": {
      return last.merge?.depth ?? 0;
    }
    case "loop": {
      return last.end.depth;
    }
    case undefined:
    default: {
      return 0;
    }
  }
};

/**
 * The depth a fork's lanes take side by side. A lane fallen into has its
 * first room deepened to reach MIN_SHARED below the top of the last room of
 * the lane before, so along a chain of fallthroughs the lanes step down.
 */
const lanesDepth = (lanes: readonly LaneSpec[]): number => {
  let deepest = 0;
  // The depth from the fork's top to the top of the last lane's last room.
  let reach = 0;
  for (const lane of lanes) {
    const own = depthEstimate(lane.body);
    const first = firstDepth(lane.body);
    const depth = lane.fallenInto
      ? own - first + Math.max(first, reach + MIN_SHARED)
      : own;
    deepest = Math.max(deepest, depth);
    reach = depth - lastDepth(lane.body);
  }
  return deepest;
};

/** The depth a sequence will take once placed: lanes side by side count once. */
const depthEstimate = (items: readonly FlowTree[]): number =>
  items.reduce((depth, item) => {
    switch (item.kind) {
      case "fork": {
        return (
          depth +
          placedDepth(item.head) +
          lanesDepth(item.lanes) +
          (item.merge === null ? 0 : item.merge.depth)
        );
      }
      case "loop": {
        return (
          depth +
          placedDepth(item.head) +
          depthEstimate(item.body) +
          placedDepth(item.test) +
          item.end.depth
        );
      }
      case "room":
      default: {
        return depth + placedDepth(item);
      }
    }
  }, 0);

/** Every room's label by id, for the HUD. */
const labelsOf = (items: readonly FlowTree[]): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  const visit = (current: readonly FlowTree[]) => {
    for (const item of current) {
      if (item.kind === "room") {
        labels.set(item.id, item.label);
        continue;
      }
      for (const room of ownRooms(item)) {
        labels.set(room.id, room.label);
      }
      for (const body of bodiesOf(item)) {
        visit(body);
      }
    }
  };
  visit(items);
  return labels;
};

/** Rooms with a marker, mapped to the calls it stands for (site ids). */
const markersOf = (
  items: readonly FlowTree[]
): ReadonlyMap<string, readonly string[]> => {
  const markers = new Map<string, readonly string[]>();
  const visit = (current: readonly FlowTree[]) => {
    for (const item of current) {
      const rooms = item.kind === "room" ? [item] : ownRooms(item);
      for (const room of rooms) {
        if (room.markers.length > 0) {
          markers.set(room.id, room.markers);
        }
      }
      if (item.kind !== "room") {
        for (const body of bodiesOf(item)) {
          visit(body);
        }
      }
    }
  };
  visit(items);
  return markers;
};

export {
  BACK_LANE,
  BODY_LANE,
  bodiesOf,
  depthEstimate,
  EXIT_LANE,
  labelsOf,
  laneWidth,
  markersOf,
  ownRooms,
  roomCount,
  treeWidth,
  withBodies,
};
export type { CompositeSpec, FlowTree, ForkSpec, LaneSpec, LoopSpec };
