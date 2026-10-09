// The shapes of a function's interior before it is placed: a tree of rooms
// in which a branch or switch is a fork (head, lanes, merge) and a loop a
// ring (head, body, test, back corridor, end). Widths, room counts, depth
// estimates and labels come from the tree bottom-up; the budget and the
// placer walk composites through `bodiesOf` and `withBodies`.

import type { LaneLabel } from "@repo/types";
import { FLOW_LANE_WIDTH } from "@repo/world-generator/config";

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

const laneWidth = (lane: LaneSpec): number => bodyWidth(lane.body);

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

/** The depth a sequence will take once placed: lanes side by side count once. */
const depthEstimate = (items: readonly FlowTree[]): number =>
  items.reduce((depth, item) => {
    switch (item.kind) {
      case "fork": {
        return (
          depth +
          placedDepth(item.head) +
          Math.max(...item.lanes.map((lane) => depthEstimate(lane.body))) +
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

export {
  BACK_LANE,
  BODY_LANE,
  bodiesOf,
  depthEstimate,
  EXIT_LANE,
  labelsOf,
  laneWidth,
  ownRooms,
  roomCount,
  treeWidth,
  withBodies,
};
export type { CompositeSpec, FlowTree, ForkSpec, LaneSpec, LoopSpec };
