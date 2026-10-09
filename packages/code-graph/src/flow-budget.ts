// Keeps an interior within FLOW_BUDGET: forks and loops nested deepest are
// collapsed back into one room while the tree is too wide, then neighbouring
// rooms fold into `collapsed` ones, shallowest pairs first, until it fits.

import type { FlowRole } from "@repo/types";
import { FLOW_BUDGET } from "@repo/world-generator/config";

import {
  bodiesOf,
  depthEstimate,
  ownRooms,
  roomCount,
  treeWidth,
  withBodies,
} from "./flow-composite";
import type { CompositeSpec, FlowTree } from "./flow-composite";
import { depthOf, specOf } from "./flow-measure";
import type { FlowCallee, FlowRoomSpec } from "./flow-measure";
import { foldedText } from "./flow-text";
import type { SiteIndex } from "./flow-text";

/** Rooms that may merge: not returns, which end the flow. */
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

/** The composites either room of a folded pair leaves by a hidden jump. */
const escapesOf = (
  a: FlowRoomSpec,
  b: FlowRoomSpec
): Pick<FlowRoomSpec, "escapes"> => {
  const escapes = [...new Set([...(a.escapes ?? []), ...(b.escapes ?? [])])];
  return escapes.length === 0 ? {} : { escapes };
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
    kind: "room",
    id: a.id,
    role: "collapsed",
    label: foldedText(statements, calls),
    statements,
    calls,
    callees,
    depth: depthOf("collapsed", statements, callees.length, entry),
    floor: depthOf("collapsed", statements, 0, entry),
    terminal: b.terminal,
    // A pair ending in a room that jumps out still jumps out, and keeps
    // every jump either room hides.
    ...(b.jumpTo === undefined ? {} : { jumpTo: b.jumpTo }),
    ...escapesOf(a, b),
  };
};

const overBudget = (items: readonly FlowTree[]): boolean =>
  roomCount(items) > FLOW_BUDGET.rooms ||
  depthEstimate(items) > FLOW_BUDGET.depth;

type Deepest = {
  readonly composite: CompositeSpec;
  readonly level: number;
  readonly rooms: number;
};

const deeper = (a: Deepest | null, b: Deepest | null): Deepest | null =>
  a === null ||
  (b !== null &&
    (b.level > a.level || (b.level === a.level && b.rooms > a.rooms)))
    ? b
    : a;

/**
 * The composite nested deepest, ties to the one with most rooms, found in
 * one pass that counts rooms on the way back up.
 */
const deepestComposite = (
  items: readonly FlowTree[],
  level: number
): { readonly best: Deepest | null; readonly rooms: number } => {
  let best: Deepest | null = null;
  let rooms = 0;
  for (const item of items) {
    if (item.kind === "room") {
      rooms += 1;
      continue;
    }
    let own = ownRooms(item).length;
    for (const body of bodiesOf(item)) {
      const inner = deepestComposite(body, level + 1);
      own += inner.rooms;
      best = deeper(best, inner.best);
    }
    best = deeper(best, { composite: item, level, rooms: own });
    rooms += own;
  }
  return { best, rooms };
};

const replaceComposite = (
  items: readonly FlowTree[],
  target: CompositeSpec,
  sites: SiteIndex,
  top: boolean
): readonly FlowTree[] =>
  items.map((item, index) => {
    if (item === target) {
      return specOf(item.node, sites, top && index === 0);
    }
    return item.kind === "room"
      ? item
      : withBodies(item, (body) =>
          replaceComposite(body, target, sites, false)
        );
  });

/** The tree with its deepest composite collapsed, or null when it has none. */
const collapseDeepest = (
  items: readonly FlowTree[],
  sites: SiteIndex
): readonly FlowTree[] | null => {
  const deepest = deepestComposite(items, 0).best;
  return deepest === null
    ? null
    : replaceComposite(items, deepest.composite, sites, true);
};

type Pair = {
  readonly sequence: readonly FlowTree[];
  readonly index: number;
  readonly depth: number;
};

/** The shallowest adjacent foldable pair in any sequence of the tree. */
const shallowestPair = (items: readonly FlowTree[]): Pair | null => {
  let best: Pair | null = null;
  const consider = (candidate: Pair | null) => {
    if (candidate !== null && (best === null || candidate.depth < best.depth)) {
      best = candidate;
    }
  };
  for (let index = 0; index + 1 < items.length; index += 1) {
    const a = items[index];
    const b = items[index + 1];
    if (
      a?.kind === "room" &&
      b?.kind === "room" &&
      FOLDABLE.has(a.role) &&
      FOLDABLE.has(b.role)
    ) {
      consider({ sequence: items, index, depth: a.depth + b.depth });
    }
  }
  for (const item of items) {
    if (item.kind !== "room") {
      for (const body of bodiesOf(item)) {
        consider(shallowestPair(body));
      }
    }
  }
  return best;
};

const replaceSequence = (
  items: readonly FlowTree[],
  target: readonly FlowTree[],
  replacement: readonly FlowTree[]
): readonly FlowTree[] =>
  items === target
    ? replacement
    : items.map((item) =>
        item.kind === "room"
          ? item
          : withBodies(item, (body) =>
              replaceSequence(body, target, replacement)
            )
      );

/** The tree with its shallowest foldable pair folded, or null when none is. */
const foldShallowest = (
  items: readonly FlowTree[]
): readonly FlowTree[] | null => {
  const pair = shallowestPair(items);
  const a = pair?.sequence[pair.index];
  const b = pair?.sequence[pair.index + 1];
  if (pair === null || a?.kind !== "room" || b?.kind !== "room") {
    return null;
  }
  const folded = [
    ...pair.sequence.slice(0, pair.index),
    merge(a, b, pair.sequence === items && pair.index === 0),
    ...pair.sequence.slice(pair.index + 2),
  ];
  return replaceSequence(items, pair.sequence, folded);
};

/**
 * Folds until the tree is within budget or nothing more can change. Too
 * wide: the deepest fork or loop collapses into one room. Too deep or too
 * many rooms: neighbouring rooms fold, then composites collapse. A folded
 * room keeps its first room's id and a collapsed composite its node's, so
 * the HUD still
 * resolves them; labels carry the true counts. The budget is a target, not
 * a guarantee: a room's own depth is capped, but the wall its distinct
 * callees need is not, so a room calling very many functions can still
 * exceed it.
 */
const foldToBudget = (
  items: readonly FlowTree[],
  sites: SiteIndex
): readonly FlowTree[] => {
  let current = items;
  for (;;) {
    if (treeWidth(current) > FLOW_BUDGET.width) {
      const narrower = collapseDeepest(current, sites);
      if (narrower === null) {
        return current;
      }
      current = narrower;
      continue;
    }
    if (!overBudget(current)) {
      return current;
    }
    const next = foldShallowest(current) ?? collapseDeepest(current, sites);
    if (next === null) {
      return current;
    }
    current = next;
  }
};

export { foldToBudget, replaceComposite };
