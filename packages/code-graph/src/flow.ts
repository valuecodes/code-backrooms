// Walking and judging flow trees. Pure functions over the node family in
// code-graph.ts; nothing here knows about parsers or rooms.

import type { FlowNode } from "./code-graph";

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

/** Whether a `break` anywhere under `node` leaves `targetId`. */
const breaksOutOf = (node: FlowNode, targetId: string): boolean => {
  let found = false;
  walkFlow(node, (current) => {
    if (current.kind === "break" && current.targetId === targetId) {
      found = true;
    }
  });
  return found;
};

/**
 * Whether control never runs past the node: a jump, a branch whose lanes
 * both are, a switch that covers `default`, ends every case and is never
 * broken out of, a sequence by its last step. Loops never are (their
 * condition may fail at once), nor plain steps, calls and awaits.
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
    case "switch": {
      return (
        node.cases.some((item) => item.labels.includes("default")) &&
        node.cases.every(
          (item) => isTerminal(item.body) && !item.fallsThrough
        ) &&
        !node.cases.some((item) => breaksOutOf(item.body, node.id))
      );
    }
    case "sequence": {
      const last = node.steps.at(-1);
      return last !== undefined && isTerminal(last);
    }
    case "loop":
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
    case "loop": {
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
