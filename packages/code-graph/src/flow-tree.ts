// A function's interior before it is placed: a tree of rooms. A branch or
// switch is a fork (a head room, one lane per way through, a merge room
// where the lanes rejoin); everything else is one room. Widths come from
// the tree bottom-up; the placer stretches lanes to fill their column.

import type { LaneLabel } from "@repo/types";
import {
  FLOW_LANE_WIDTH,
  FLOW_LEAF_DEPTH,
  FLOW_MAX_CASES,
} from "@repo/world-generator/config";

import type {
  BranchNode,
  FlowStep,
  FunctionNode,
  SequenceNode,
  SwitchNode,
} from "./code-graph";
import { isTerminal, walkFlow } from "./flow";
import {
  calleesOf,
  depthOf,
  emptyBodySpec,
  PORT_PITCH,
  specOf,
} from "./flow-measure";
import type { FlowRoomSpec } from "./flow-measure";
import { emptyLaneText, forkText, mergeText, resolvedSites } from "./flow-text";
import type { SiteIndex } from "./flow-text";
import { flowNodeId, parseFlowNodeId } from "./ids";

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

type FlowTree = FlowRoomSpec | ForkSpec;

/** A `break` the parser kept is nested in a case; it needs a jump portal to leave. */
const hasNestedBreak = (node: SwitchNode): boolean => {
  let found = false;
  walkFlow(node, (current) => {
    if (current.kind === "break" && current.targetId === node.id) {
      found = true;
    }
  });
  return found;
};

/** Whether a composite is laid out as a fork rather than kept collapsed. */
const expands = (node: FlowStep): node is BranchNode | SwitchNode =>
  node.kind === "branch" ||
  (node.kind === "switch" &&
    node.cases.length <= FLOW_MAX_CASES &&
    !hasNestedBreak(node));

/** The same id with a tag: the merge room and the synthesised default lane. */
const tagged = (node: BranchNode | SwitchNode, tag: string): string => {
  const ref = parseFlowNodeId(node.id);
  return ref === null
    ? `${node.id}:${tag}`
    : flowNodeId(ref.functionId, ref.offset, ref.kind, tag);
};

const headSpec = (
  node: BranchNode | SwitchNode,
  sites: SiteIndex,
  entry: boolean
): FlowRoomSpec => {
  const role = node.kind === "branch" ? "fork" : "switch";
  const callees = calleesOf(node.callSiteIds, sites);
  return {
    kind: "room",
    id: node.id,
    role,
    label: forkText(node),
    statements: 1,
    calls: resolvedSites(node.callSiteIds, sites).length,
    callees,
    depth: depthOf(role, 1, callees.length, entry),
    floor: depthOf(role, 1, 0, entry),
    terminal: false,
  };
};

const plainSpec = (
  id: string,
  role: "merge" | "lane",
  label: string
): FlowRoomSpec => ({
  kind: "room",
  id,
  role,
  label,
  statements: 0,
  calls: 0,
  callees: [],
  depth: FLOW_LEAF_DEPTH,
  floor: FLOW_LEAF_DEPTH,
  terminal: false,
});

const laneOf = (
  id: string,
  label: LaneLabel,
  body: SequenceNode | null,
  rejoins: boolean,
  sites: SiteIndex
): LaneSpec => ({
  id,
  label,
  body:
    body === null || body.steps.length === 0
      ? [plainSpec(id, "lane", emptyLaneText(label))]
      : measureSteps(body.steps, sites, false),
  rejoins,
});

const lanesOf = (
  node: BranchNode | SwitchNode,
  sites: SiteIndex
): readonly LaneSpec[] => {
  if (node.kind === "branch") {
    return [
      laneOf(
        node.consequent.id,
        { kind: "true" },
        node.consequent,
        !isTerminal(node.consequent),
        sites
      ),
      laneOf(
        node.alternate.id,
        { kind: "false" },
        node.alternate,
        !isTerminal(node.alternate),
        sites
      ),
    ];
  }
  const lanes = node.cases.map((item) => {
    const isDefault = item.labels.includes("default");
    const label: LaneLabel =
      isDefault && item.labels.length === 1
        ? { kind: "default" }
        : {
            kind: isDefault ? "default" : "case",
            text: item.labels.join(", "),
          };
    return laneOf(
      item.body.id,
      label,
      item.body,
      !isTerminal(item.body) || item.fallsThrough,
      sites
    );
  });
  // Without a `default` the switch may match nothing and run straight on.
  const covered = node.cases.some((item) => item.labels.includes("default"));
  return covered
    ? lanes
    : [
        ...lanes,
        laneOf(tagged(node, "default"), { kind: "default" }, null, true, sites),
      ];
};

const forkOf = (
  node: BranchNode | SwitchNode,
  sites: SiteIndex,
  entry: boolean
): ForkSpec => {
  const lanes = lanesOf(node, sites);
  return {
    kind: "fork",
    node,
    head: headSpec(node, sites, entry),
    lanes,
    merge: lanes.some((lane) => lane.rejoins)
      ? plainSpec(tagged(node, "merge"), "merge", mergeText(node))
      : null,
  };
};

const measureSteps = (
  steps: readonly FlowStep[],
  sites: SiteIndex,
  entry: boolean
): readonly FlowTree[] =>
  steps.map((step, position) =>
    expands(step)
      ? forkOf(step, sites, entry && position === 0)
      : specOf(step, sites, entry && position === 0)
  );

/** The tree of a function's body; an empty body is one empty step. */
const measureTree = (
  fn: FunctionNode,
  sites: SiteIndex
): readonly FlowTree[] => {
  const items = measureSteps(fn.flow.steps, sites, true);
  return items.length > 0 ? items : [emptyBodySpec(fn)];
};

/** The width a lane needs: at least one lane, or what its body needs. */
const laneWidth = (lane: LaneSpec): number =>
  Math.max(FLOW_LANE_WIDTH, treeWidth(lane.body));

/** The width a sequence needs: its widest fork; rooms take the column's. */
const treeWidth = (items: readonly FlowTree[]): number =>
  items.reduce(
    (width, item) =>
      item.kind === "fork"
        ? Math.max(
            width,
            item.lanes.reduce((sum, lane) => sum + laneWidth(lane), 0)
          )
        : width,
    0
  );

const roomCount = (items: readonly FlowTree[]): number =>
  items.reduce(
    (count, item) =>
      count +
      (item.kind === "fork"
        ? 1 +
          (item.merge === null ? 0 : 1) +
          item.lanes.reduce((sum, lane) => sum + roomCount(lane.body), 0)
        : 1),
    0
  );

/** A room with calls may be grown to the port pitch when placed; budget for it. */
const placedDepth = (spec: FlowRoomSpec): number =>
  spec.callees.length > 0 ? Math.max(spec.depth, PORT_PITCH) : spec.depth;

/** The depth a sequence will take once placed: lanes side by side count once. */
const depthEstimate = (items: readonly FlowTree[]): number =>
  items.reduce(
    (depth, item) =>
      depth +
      (item.kind === "fork"
        ? placedDepth(item.head) +
          Math.max(...item.lanes.map((lane) => depthEstimate(lane.body))) +
          (item.merge === null ? 0 : item.merge.depth)
        : placedDepth(item)),
    0
  );

/** Every room's label by id, for the HUD. */
const labelsOf = (items: readonly FlowTree[]): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  const visit = (current: readonly FlowTree[]) => {
    for (const item of current) {
      if (item.kind === "fork") {
        labels.set(item.head.id, item.head.label);
        if (item.merge !== null) {
          labels.set(item.merge.id, item.merge.label);
        }
        for (const lane of item.lanes) {
          visit(lane.body);
        }
      } else {
        labels.set(item.id, item.label);
      }
    }
  };
  visit(items);
  return labels;
};

export {
  depthEstimate,
  labelsOf,
  laneWidth,
  measureTree,
  roomCount,
  treeWidth,
};
export type { FlowTree, ForkSpec, LaneSpec };
