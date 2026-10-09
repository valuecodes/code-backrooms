// Measures a function's body into a tree of rooms: a branch or switch
// becomes a fork, a loop a ring, everything else one room. The shapes and
// their metrics live in flow-composite.ts; the placer stretches them.

import type { FlowRole, LaneLabel } from "@repo/types";
import {
  FLOW_BUDGET,
  FLOW_LEAF_DEPTH,
  FLOW_MAX_CASES,
} from "@repo/world-generator/config";

import type {
  BranchNode,
  FlowStep,
  FunctionNode,
  LoopNode,
  SequenceNode,
  SwitchNode,
} from "./code-graph";
import { isTerminal, jumpsTo } from "./flow";
import { BODY_LANE } from "./flow-composite";
import type { FlowTree, ForkSpec, LaneSpec, LoopSpec } from "./flow-composite";
import { calleesOf, depthOf, emptyBodySpec, specOf } from "./flow-measure";
import type { FlowRoomSpec } from "./flow-measure";
import {
  emptyLaneText,
  forkText,
  loopEndText,
  loopHeadText,
  loopTestText,
  mergeText,
  resolvedSites,
} from "./flow-text";
import type { SiteIndex } from "./flow-text";
import { taggedFlowNodeId } from "./ids";

/**
 * How many forks and loops a function may open: each is four rooms at
 * least, so beyond a quarter of the room budget the rest would only be
 * folded back.
 * Bounding it up front keeps the budget pass cheap for huge functions.
 */
const FORK_QUOTA = Math.floor(FLOW_BUDGET.rooms / 4);

/** Lane texts are source slices; merged case labels are cut like any other. */
const LANE_TEXT_MAX = 60;

type Quota = {
  /** Takes one from the quota; false when none is left. */
  readonly take: () => boolean;
};

const forkQuota = (count: number): Quota => {
  let left = count;
  return {
    take: () => {
      if (left === 0) {
        return false;
      }
      left -= 1;
      return true;
    },
  };
};

/** What one function's measuring carries along. */
type Measure = {
  readonly sites: SiteIndex;
  readonly quota: Quota;
};

const cut = (text: string): string =>
  text.length > LANE_TEXT_MAX ? `${text.slice(0, LANE_TEXT_MAX - 1)}…` : text;

/**
 * Whether a composite is laid out as a fork or a ring rather than kept
 * collapsed. A switch with a case that falls through needs a door into the
 * next lane, which does not exist yet. A loop needs a way into its test
 * and end rooms: its body running out of its end, or a jump to the loop
 * (whose portal leads there); a body that only ever returns keeps it one
 * room.
 */
const expands = (
  node: FlowStep
): node is BranchNode | SwitchNode | LoopNode => {
  switch (node.kind) {
    case "branch": {
      return true;
    }
    case "switch": {
      return (
        node.cases.length <= FLOW_MAX_CASES &&
        !node.cases.some((item) => item.fallsThrough)
      );
    }
    case "loop": {
      return !isTerminal(node.body) || jumpsTo(node.body, node.id);
    }
    case "step":
    case "call":
    case "await":
    case "return":
    case "break":
    case "continue":
    case "try":
    default: {
      return false;
    }
  }
};

/** The same id with a tag: a merge, a synthesised default, a loop's rooms. */
const tagged = (
  node: BranchNode | SwitchNode | LoopNode,
  tag: string
): string => taggedFlowNodeId(node.id, tag);

/** A room of a composite holding the calls of its header or condition. */
const headerSpec = (
  id: string,
  role: FlowRole,
  label: string,
  callSiteIds: readonly string[],
  sites: SiteIndex,
  entry: boolean
): FlowRoomSpec => {
  const callees = calleesOf(callSiteIds, sites);
  return {
    kind: "room",
    id,
    role,
    label,
    statements: 1,
    calls: resolvedSites(callSiteIds, sites).length,
    callees,
    depth: depthOf(role, 1, callees.length, entry),
    floor: depthOf(role, 1, 0, entry),
    terminal: false,
  };
};

const plainSpec = (
  id: string,
  role: FlowRole,
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
  measure: Measure
): LaneSpec => ({
  id,
  label,
  body:
    body === null || body.steps.length === 0
      ? [plainSpec(id, "lane", emptyLaneText(label))]
      : measureSteps(body.steps, measure, false),
  rejoins,
});

const lanesOf = (
  node: BranchNode | SwitchNode,
  measure: Measure
): readonly LaneSpec[] => {
  if (node.kind === "branch") {
    return [
      laneOf(
        node.consequent.id,
        { kind: "true" },
        node.consequent,
        !isTerminal(node.consequent),
        measure
      ),
      laneOf(
        node.alternate.id,
        { kind: "false" },
        node.alternate,
        !isTerminal(node.alternate),
        measure
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
            text: cut(item.labels.join(", ")),
          };
    return laneOf(
      item.body.id,
      label,
      item.body,
      !isTerminal(item.body),
      measure
    );
  });
  // Without a `default` the switch may match nothing and run straight on.
  const covered = node.cases.some((item) => item.labels.includes("default"));
  return covered
    ? lanes
    : [
        ...lanes,
        laneOf(
          tagged(node, "default"),
          { kind: "default" },
          null,
          true,
          measure
        ),
      ];
};

const forkOf = (
  node: BranchNode | SwitchNode,
  measure: Measure,
  entry: boolean
): ForkSpec => {
  const lanes = lanesOf(node, measure);
  return {
    kind: "fork",
    node,
    head: headerSpec(
      node.id,
      node.kind === "branch" ? "fork" : "switch",
      forkText(node),
      node.callSiteIds,
      measure.sites,
      entry
    ),
    lanes,
    // A `break` nested in a case leads to the merge room too.
    merge:
      lanes.some((lane) => lane.rejoins) || jumpsTo(node, node.id)
        ? plainSpec(tagged(node, "merge"), "merge", mergeText(node))
        : null,
  };
};

/**
 * A loop's ring. The header's calls hang off the room that shows it: the
 * head, or for a do-while (tested at the end) the test room.
 */
const loopOf = (node: LoopNode, measure: Measure, entry: boolean): LoopSpec => {
  const tested = node.loopKind === "do-while";
  const header = (
    id: string,
    role: FlowRole,
    label: string,
    owns: boolean,
    isEntry: boolean
  ) =>
    headerSpec(
      id,
      role,
      label,
      owns ? node.callSiteIds : [],
      measure.sites,
      isEntry
    );
  return {
    kind: "loop",
    node,
    head: header(node.id, "loop-head", loopHeadText(node), !tested, entry),
    body:
      node.body.steps.length === 0
        ? [plainSpec(node.body.id, "lane", emptyLaneText(BODY_LANE))]
        : measureSteps(node.body.steps, measure, false),
    test: header(
      tagged(node, "again"),
      "loop-test",
      loopTestText(node),
      tested,
      false
    ),
    back: plainSpec(tagged(node, "back"), "loop-back", "repeat"),
    end: plainSpec(tagged(node, "end"), "loop-end", loopEndText(node)),
  };
};

const measureSteps = (
  steps: readonly FlowStep[],
  measure: Measure,
  entry: boolean
): readonly FlowTree[] =>
  steps.map((step, position) => {
    const first = entry && position === 0;
    if (!expands(step) || !measure.quota.take()) {
      return specOf(step, measure.sites, first);
    }
    return step.kind === "loop"
      ? loopOf(step, measure, first)
      : forkOf(step, measure, first);
  });

/**
 * The tree of a function's body, the first FORK_QUOTA forks in source
 * order opened and the rest kept collapsed; an empty body is one empty step.
 */
const measureTree = (
  fn: FunctionNode,
  sites: SiteIndex
): readonly FlowTree[] => {
  const items = measureSteps(
    fn.flow.steps,
    { sites, quota: forkQuota(FORK_QUOTA) },
    true
  );
  return items.length > 0 ? items : [emptyBodySpec(fn)];
};

export { FORK_QUOTA, measureTree };
