// Keeps an interior within FLOW_BUDGET by folding neighbouring rooms into
// one `collapsed` room, shallowest pairs first, until it fits.

import type { FlowRole } from "@repo/types";
import { FLOW_BUDGET } from "@repo/world-generator/config";

import { depthOf, PORT_PITCH } from "./flow-measure";
import type { FlowCallee, FlowRoomSpec } from "./flow-measure";
import { foldedText } from "./flow-text";

/** Rooms that may merge: not returns or jumps, which end or leave the flow. */
const FOLDABLE: ReadonlySet<FlowRole> = new Set<FlowRole>([
  "step",
  "call",
  "await",
  "collapsed",
]);

const distinctCallees = (
  callees: readonly FlowCallee[]
): readonly FlowCallee[] => {
  const seen = new Set<string>();
  return callees.filter((callee) => {
    if (seen.has(callee.unitId)) {
      return false;
    }
    seen.add(callee.unitId);
    return true;
  });
};

const merge = (
  a: FlowRoomSpec,
  b: FlowRoomSpec,
  entry: boolean
): FlowRoomSpec => {
  const statements = a.statements + b.statements;
  const calls = a.calls + b.calls;
  const callees = distinctCallees([...a.callees, ...b.callees]);
  return {
    id: a.id,
    role: "collapsed",
    label: foldedText(statements, calls),
    statements,
    calls,
    callees,
    depth: depthOf("collapsed", statements, callees.length, entry),
  };
};

/** A room with calls may be grown to the port pitch when placed; budget for it. */
const placedDepth = (spec: FlowRoomSpec): number =>
  spec.callees.length > 0 ? Math.max(spec.depth, PORT_PITCH) : spec.depth;

const overBudget = (specs: readonly FlowRoomSpec[]): boolean =>
  specs.length > FLOW_BUDGET.rooms ||
  specs.reduce((sum, spec) => sum + placedDepth(spec), 0) > FLOW_BUDGET.depth;

/** The index of the shallowest adjacent foldable pair, or -1. */
const shallowestPair = (specs: readonly FlowRoomSpec[]): number => {
  let best = -1;
  let bestDepth = Infinity;
  for (let index = 0; index + 1 < specs.length; index += 1) {
    const a = specs[index];
    const b = specs[index + 1];
    if (
      a !== undefined &&
      b !== undefined &&
      FOLDABLE.has(a.role) &&
      FOLDABLE.has(b.role) &&
      a.depth + b.depth < bestDepth
    ) {
      best = index;
      bestDepth = a.depth + b.depth;
    }
  }
  return best;
};

/**
 * Folds until the column is within budget or nothing more can fold. A
 * folded room keeps its first room's id, so the HUD still resolves it; its
 * label carries the true counts. The budget is a target, not a guarantee:
 * a collapsed room's own depth is capped, but the wall its distinct callees
 * need is not, so a room calling very many functions can still exceed it.
 */
const foldToBudget = (
  specs: readonly FlowRoomSpec[]
): readonly FlowRoomSpec[] => {
  let current = specs;
  while (overBudget(current)) {
    const index = shallowestPair(current);
    const a = current[index];
    const b = current[index + 1];
    if (index === -1 || a === undefined || b === undefined) {
      break;
    }
    current = [
      ...current.slice(0, index),
      merge(a, b, index === 0),
      ...current.slice(index + 2),
    ];
  }
  return current;
};

export { foldToBudget };
