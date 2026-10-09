// Walking and judging flow trees. Pure functions over the node family in
// code-graph.ts; nothing here knows about parsers or rooms.

import type { FlowNode, SwitchNode } from "./code-graph";

/** The nodes one level down: lanes, case bodies, loop bodies, steps. */
const childrenOf = (node: FlowNode): readonly FlowNode[] => {
  switch (node.kind) {
    case "sequence": {
      return node.steps;
    }
    case "branch": {
      return [node.consequent, node.alternate];
    }
    case "switch": {
      return node.cases.map((item) => item.body);
    }
    case "loop": {
      return [node.body];
    }
    case "try": {
      return [node.block, node.handler, node.finalizer].filter(
        (part) => part !== null
      );
    }
    case "step":
    case "call":
    case "await":
    case "return":
    case "break":
    case "continue":
    default: {
      return [];
    }
  }
};

/** Pre-order visit of `root` and everything under it, outermost ancestor first. */
const walkFlow = (
  root: FlowNode,
  visit: (node: FlowNode, ancestors: readonly FlowNode[]) => void,
  ancestors: readonly FlowNode[] = []
): void => {
  visit(root, ancestors);
  const inner = [...ancestors, root];
  for (const child of childrenOf(root)) {
    walkFlow(child, visit, inner);
  }
};

/** Whether a `break` (or, with `continues`, a `continue`) under `node` targets `targetId`. */
const jumpsOutOf = (
  node: FlowNode,
  targetId: string,
  continues: boolean
): boolean => {
  if (node.kind === "break" || (continues && node.kind === "continue")) {
    return node.targetId === targetId;
  }
  return childrenOf(node).some((child) =>
    jumpsOutOf(child, targetId, continues)
  );
};

/**
 * Whether every way into the cases ends: a case ends when its body does, or
 * when it falls through into a case that ends.
 */
const casesEnd = (cases: SwitchNode["cases"]): boolean => {
  let nextEnds = false;
  for (const item of [...cases].reverse()) {
    nextEnds = isTerminal(item.body) || (item.fallsThrough && nextEnds);
    if (!nextEnds) {
      return false;
    }
  }
  return true;
};

/**
 * Whether control never runs past the node: a jump, a branch whose lanes
 * both are, a switch that covers `default`, ends every case and is never
 * broken out of (a case that falls through ends when the next one does), a
 * try whose finalizer ends or whose block and handler both end, a do-while
 * whose body ends and is never left by a jump, a sequence by its last step.
 * Other loops never are (their condition may fail at once), nor plain
 * steps, calls and awaits.
 */
const isTerminal = (node: FlowNode): boolean => {
  switch (node.kind) {
    case "return":
    case "break":
    case "continue": {
      return true;
    }
    case "branch": {
      return isTerminal(node.consequent) && isTerminal(node.alternate);
    }
    case "try": {
      return (
        (node.finalizer !== null && isTerminal(node.finalizer)) ||
        (isTerminal(node.block) &&
          (node.handler === null || isTerminal(node.handler)))
      );
    }
    case "switch": {
      return (
        node.cases.some((item) => item.labels.includes("default")) &&
        casesEnd(node.cases) &&
        !node.cases.some((item) => jumpsOutOf(item.body, node.id, false))
      );
    }
    case "loop": {
      // A do-while runs its body once before testing; any other loop may
      // not run at all.
      return (
        node.loopKind === "do-while" &&
        isTerminal(node.body) &&
        !jumpsOutOf(node.body, node.id, true)
      );
    }
    case "sequence": {
      const last = node.steps.at(-1);
      return last !== undefined && isTerminal(last);
    }
    case "step":
    case "call":
    case "await":
    default: {
      return false;
    }
  }
};

/** Statements under a node: folded steps by their count, composites plus one. */
const countStatements = (node: FlowNode): number => {
  const inner = childrenOf(node).reduce(
    (sum, child) => sum + countStatements(child),
    0
  );
  switch (node.kind) {
    case "step": {
      return node.statements;
    }
    case "sequence": {
      return inner;
    }
    case "branch":
    case "switch":
    case "loop":
    case "try": {
      return 1 + inner;
    }
    case "call":
    case "await":
    case "return":
    case "break":
    case "continue":
    default: {
      return 1;
    }
  }
};

type FoundFlowNode = {
  readonly node: FlowNode;
  /** Outermost first, the body sequence included. */
  readonly ancestors: readonly FlowNode[];
};

/** The node with `id` under `root`, with the path down to it, or null. */
const findFlowNode = (root: FlowNode, id: string): FoundFlowNode | null => {
  let found: FoundFlowNode | null = null;
  walkFlow(root, (node, ancestors) => {
    if (found === null && node.id === id) {
      found = { node, ancestors };
    }
  });
  return found;
};

export { countStatements, findFlowNode, isTerminal, walkFlow };
export type { FoundFlowNode };
