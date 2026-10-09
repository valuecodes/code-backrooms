// Jump portals after folding: which rooms jump where, and composites kept
// collapsed when a jump into them cannot be shown: folding swallowed every
// jump into their rooms, or a collapsed room leaves them in more than one
// way.

import { isTerminal } from "./flow";
import { replaceComposite } from "./flow-budget";
import { bodiesOf } from "./flow-composite";
import type { CompositeSpec, FlowTree } from "./flow-composite";
import type { SiteIndex } from "./flow-text";

/** Every room with a jump portal, mapped to the room it leads to. */
const jumpsOf = (items: readonly FlowTree[]): ReadonlyMap<string, string> => {
  const jumps = new Map<string, string>();
  const visit = (current: readonly FlowTree[]) => {
    for (const item of current) {
      if (item.kind === "room") {
        if (item.jumpTo !== undefined) {
          jumps.set(item.id, item.jumpTo);
        }
        continue;
      }
      for (const body of bodiesOf(item)) {
        visit(body);
      }
    }
  };
  visit(items);
  return jumps;
};

/** The loops and switches some collapsed room leaves in more than one way. */
const escapedOf = (items: readonly FlowTree[]): ReadonlySet<string> => {
  const escaped = new Set<string>();
  const visit = (current: readonly FlowTree[]) => {
    for (const item of current) {
      if (item.kind === "room") {
        for (const id of item.escapes ?? []) {
          escaped.add(id);
        }
        continue;
      }
      for (const body of bodiesOf(item)) {
        visit(body);
      }
    }
  };
  visit(items);
  return escaped;
};

/**
 * Whether a composite's own rooms are left without a way in: a switch
 * whose lanes all end but whose merge room was made for a nested `break`,
 * or a loop whose body never runs out of its end, when no jump portal
 * leads there any more.
 */
const stranded = (
  item: CompositeSpec,
  targets: ReadonlySet<string>
): boolean => {
  if (item.kind === "loop") {
    return (
      isTerminal(item.node.body) &&
      !targets.has(item.test.id) &&
      !targets.has(item.end.id)
    );
  }
  return (
    item.merge !== null &&
    !item.lanes.some((lane) => lane.rejoins) &&
    !targets.has(item.merge.id)
  );
};

/**
 * The innermost composite to collapse, children before their parents: one
 * stranded, or one a collapsed room leaves in more than one way.
 */
const firstStranded = (
  items: readonly FlowTree[],
  targets: ReadonlySet<string>,
  escaped: ReadonlySet<string>
): CompositeSpec | null => {
  for (const item of items) {
    if (item.kind === "room") {
      continue;
    }
    for (const body of bodiesOf(item)) {
      const inner = firstStranded(body, targets, escaped);
      if (inner !== null) {
        return inner;
      }
    }
    if (escaped.has(item.node.id) || stranded(item, targets)) {
      return item;
    }
  }
  return null;
};

/**
 * Collapses composites until every jump can be shown. Folding can swallow a
 * jump room into a collapsed room that does not end in it; its target then
 * has no way in, so that composite is collapsed too. A collapsed room that
 * ends in more than one way (a `break` and a `continue`, a jump and a
 * return) has room for one portal only, so the composites it leaves are
 * collapsed around it. Each new collapsed room may carry its own jump out,
 * which the next round sees.
 */
const keepJumpTargets = (
  items: readonly FlowTree[],
  sites: SiteIndex
): readonly FlowTree[] => {
  let current = items;
  for (;;) {
    const targets = new Set(jumpsOf(current).values());
    const target = firstStranded(current, targets, escapedOf(current));
    if (target === null) {
      return current;
    }
    current = replaceComposite(current, target, sites, true);
  }
};

export { jumpsOf, keepJumpTargets };
