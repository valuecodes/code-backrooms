// One room per top-level flow node, with the depth it needs. Width is the
// lane's; everything here is in cluster metres on the grid.

import type { FlowRole } from "@repo/types";
import {
  FLOW_CALL_DEPTH,
  FLOW_LEAF_DEPTH,
  FLOW_PORTAL_PITCH,
  FLOW_STEP_DEPTH_MAX,
  FLOW_TOP_MIN_DEPTH,
  GRID,
} from "@repo/world-generator/config";

import type { CallSite, FlowStep, FunctionNode } from "./code-graph";
import { countStatements } from "./flow";
import { flowNodeText, resolvedSites, siteIdsUnder } from "./flow-text";
import { flowNodeId } from "./ids";

/** A function called from a room, with the first site that calls it there. */
type FlowCallee = {
  readonly unitId: string;
  readonly siteId: string;
};

type FlowRoomSpec = {
  readonly id: string;
  readonly role: FlowRole;
  readonly label: string;
  readonly statements: number;
  /** Resolved calls in the room, for the label. */
  readonly calls: number;
  /** Distinct callees in site order. */
  readonly callees: readonly FlowCallee[];
  readonly depth: number;
};

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
    case "loop-end":
    case "loop-back":
    default: {
      return FLOW_LEAF_DEPTH;
    }
  }
};

/**
 * Wall for the callees: the first two get a port each (one per side wall),
 * the rest a pre-placed portal each below the port, alternating walls, at
 * FLOW_PORTAL_PITCH; 1.5 m after the last keeps it clear of the corner.
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
  sites: readonly CallSite[]
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
    case "loop": {
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

const specOf = (
  node: FlowStep,
  sites: readonly CallSite[],
  entry: boolean
): FlowRoomSpec => {
  const role = roleOf(node);
  const ids = siteIdsUnder(node);
  const callees = calleesOf(ids, sites);
  const statements = countStatements(node);
  return {
    id: node.id,
    role,
    label: flowNodeText(node, sites),
    statements,
    calls: resolvedSites(ids, sites).length,
    callees,
    depth: depthOf(role, statements, callees.length, entry),
  };
};

/**
 * The rooms of a function's top-level flow in order. Composites (branches,
 * switches, loops) are one `collapsed` room each for now, carrying every
 * call inside them. An empty body is one empty step.
 */
const measureBody = (
  fn: FunctionNode,
  sites: readonly CallSite[]
): readonly FlowRoomSpec[] => {
  const specs = fn.flow.steps.map((step, index) =>
    specOf(step, sites, index === 0)
  );
  if (specs.length > 0) {
    return specs;
  }
  return [
    {
      id: flowNodeId(fn.id, fn.flow.span.start, "step", "empty"),
      role: "step",
      label: "empty body",
      statements: 0,
      calls: 0,
      callees: [],
      depth: depthOf("step", 0, 0, true),
    },
  ];
};

export { depthOf, measureBody };
export type { FlowCallee, FlowRoomSpec };
