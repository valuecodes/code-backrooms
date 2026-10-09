// One room per flow node that is not expanded, with the depth it needs.
// Width is the column's; everything here is in cluster metres on the grid.

import type { FlowRole } from "@repo/types";
import {
  FLOW_CALL_DEPTH,
  FLOW_LEAF_DEPTH,
  FLOW_PORTAL_PITCH,
  FLOW_STEP_DEPTH_MAX,
  FLOW_TOP_MIN_DEPTH,
  FLOW_TOP_MIN_WIDTH,
  GRID,
  MIN_GAP,
} from "@repo/world-generator/config";

import type {
  BreakNode,
  ContinueNode,
  FlowStep,
  FunctionNode,
} from "./code-graph";
import { countStatements, escapingJump, hasReturn, isTerminal } from "./flow";
import { flowNodeText, resolvedSites, siteIdsUnder } from "./flow-text";
import type { SiteIndex } from "./flow-text";
import { flowNodeId, parseFlowNodeId, taggedFlowNodeId } from "./ids";

/** A function called from a room, with the first site that calls it there. */
type FlowCallee = {
  readonly unitId: string;
  readonly siteId: string;
};

type FlowRoomSpec = {
  readonly kind: "room";
  readonly id: string;
  readonly role: FlowRole;
  readonly label: string;
  readonly statements: number;
  /** Resolved calls in the room, for the label. */
  readonly calls: number;
  /** Distinct callees in site order. */
  readonly callees: readonly FlowCallee[];
  /** The depth with both side walls free for its calls: what the budget counts. */
  readonly depth: number;
  /** The depth its contents alone need; the placer grows it for the calls. */
  readonly floor: number;
  /** Control never runs past the room: a return, or a collapsed node that ends. */
  readonly terminal: boolean;
  /**
   * The room a jump portal on this room leads to: a `break` or `continue`,
   * or a collapsed node that ends by jumping out of itself.
   */
  readonly jumpTo?: string;
};

/**
 * How far apart two ports on one wall must end when the callee is as wide
 * as a plain column: it keeps MIN_GAP from the previous one, which may
 * reach MIN_GAP past its own port. The placer uses the callee's real width.
 */
const PORT_PITCH = FLOW_TOP_MIN_WIDTH + MIN_GAP;

const snap = (value: number): number => Math.round(value / GRID) * GRID;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** A step grows with what it holds: 2 m for a line or two, 8 m at most. */
const stepDepth = (statements: number): number =>
  clamp(snap(1.5 + 0.5 * statements), FLOW_LEAF_DEPTH, FLOW_STEP_DEPTH_MAX);

const baseDepth = (role: FlowRole, statements: number): number => {
  switch (role) {
    case "step": {
      return stepDepth(statements);
    }
    case "call": {
      return FLOW_CALL_DEPTH;
    }
    case "collapsed": {
      return clamp(
        snap(1.5 + 0.5 * statements),
        FLOW_CALL_DEPTH,
        FLOW_STEP_DEPTH_MAX
      );
    }
    case "await":
    case "return":
    case "jump":
    case "fork":
    case "merge":
    case "switch":
    case "lane":
    case "loop-head":
    case "loop-test":
    case "loop-end":
    case "loop-back":
    default: {
      return FLOW_LEAF_DEPTH;
    }
  }
};

/**
 * Wall for the callees when both side walls are free: the first two get a
 * port each (one per side wall), the rest a pre-placed portal each below
 * the port, alternating walls, at FLOW_PORTAL_PITCH; 1.5 m after the last
 * keeps it clear of the corner.
 */
const sitesDepth = (callees: number): number => {
  if (callees === 0) {
    return 0;
  }
  const extrasPerWall = Math.ceil(Math.max(0, callees - 2) / 2);
  return extrasPerWall === 0
    ? FLOW_CALL_DEPTH
    : FLOW_CALL_DEPTH + extrasPerWall * FLOW_PORTAL_PITCH + 1.5;
};

const depthOf = (
  role: FlowRole,
  statements: number,
  callees: number,
  entry: boolean
): number =>
  Math.max(
    baseDepth(role, statements),
    sitesDepth(callees),
    entry ? FLOW_TOP_MIN_DEPTH : 0
  );

const calleesOf = (
  ids: readonly string[],
  sites: SiteIndex
): readonly FlowCallee[] => {
  const seen = new Set<string>();
  const callees: FlowCallee[] = [];
  for (const site of resolvedSites(ids, sites)) {
    if (site.calleeId !== null && !seen.has(site.calleeId)) {
      seen.add(site.calleeId);
      callees.push({ unitId: site.calleeId, siteId: site.id });
    }
  }
  return callees;
};

const roleOf = (node: FlowStep): FlowRole => {
  switch (node.kind) {
    case "branch":
    case "switch":
    case "loop":
    case "try": {
      return "collapsed";
    }
    case "break":
    case "continue": {
      return "jump";
    }
    case "step":
    case "call":
    case "await":
    case "return":
    default: {
      return node.kind;
    }
  }
};

/**
 * The room a jump lands in: a loop's `again?` test for `continue`, its end
 * room for `break`, a switch's merge room for `break`. Null for targets
 * this grammar does not name.
 */
const jumpTarget = (jump: BreakNode | ContinueNode): string | null => {
  const kind = parseFlowNodeId(jump.targetId)?.kind;
  if (kind === "loop") {
    return taggedFlowNodeId(
      jump.targetId,
      jump.kind === "continue" ? "again" : "end"
    );
  }
  return kind === "switch" && jump.kind === "break"
    ? taggedFlowNodeId(jump.targetId, "merge")
    : null;
};

/**
 * Where a room for `node` jumps to: a jump's target, or for a collapsed
 * node that ends without returning, the target of its first jump out.
 */
const jumpOf = (node: FlowStep, terminal: boolean): string | null => {
  if (node.kind === "break" || node.kind === "continue") {
    return jumpTarget(node);
  }
  if (!terminal || hasReturn(node)) {
    return null;
  }
  const jump = escapingJump(node);
  return jump === null ? null : jumpTarget(jump);
};

/**
 * One room for a node that is not expanded: a leaf, or a composite kept
 * whole (`collapsed`) carrying every call inside it.
 */
const specOf = (
  node: FlowStep,
  sites: SiteIndex,
  entry: boolean
): FlowRoomSpec => {
  const role = roleOf(node);
  const ids = siteIdsUnder(node);
  const callees = calleesOf(ids, sites);
  const statements = countStatements(node);
  const terminal = isTerminal(node);
  const jumpTo = jumpOf(node, terminal);
  return {
    kind: "room",
    id: node.id,
    role,
    label: flowNodeText(node, sites),
    statements,
    calls: resolvedSites(ids, sites).length,
    callees,
    depth: depthOf(role, statements, callees.length, entry),
    floor: depthOf(role, statements, 0, entry),
    terminal,
    ...(jumpTo === null ? {} : { jumpTo }),
  };
};

/** The one room of a function with nothing in its body. */
const emptyBodySpec = (fn: FunctionNode): FlowRoomSpec => ({
  kind: "room",
  id: flowNodeId(fn.id, fn.flow.span.start, "step", "empty"),
  role: "step",
  label: "empty body",
  statements: 0,
  calls: 0,
  callees: [],
  depth: depthOf("step", 0, 0, true),
  floor: depthOf("step", 0, 0, true),
  terminal: false,
});

export { calleesOf, depthOf, emptyBodySpec, PORT_PITCH, specOf };
export type { FlowCallee, FlowRoomSpec };
