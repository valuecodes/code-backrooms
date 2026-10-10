// A function's control-flow graph, derived from its flow tree: one block per
// statement or composite head, typed edges between them. A test oracle and a
// debugging aid; the layout never reads it. Synthetic blocks carry the ids of
// the layout's tagged rooms (`:merge`, `:default`, `:again`, `:end`) so rooms
// and blocks can be compared by id.

import type {
  BreakNode,
  ContinueNode,
  FlowNode,
  FlowStep,
  FunctionNode,
  SequenceNode,
  TryNode,
} from "./code-graph";
import { childrenOf, isTerminal, walkFlow } from "./flow";
import { emptyBodySpec, jumpTarget } from "./flow-measure";
import { taggedFlowNodeId } from "./ids";

type CfgBlockKind =
  | FlowStep["kind"]
  /** An empty lane, case body, loop body or function body. */
  | "empty"
  | "entry"
  | "exit"
  /** Where a branch's or switch's lanes rejoin. */
  | "merge"
  /** The way through a switch that matches no case. */
  | "default"
  /** The end of a loop's iteration: repeat or leave. */
  | "again"
  /** Where a loop is left. */
  | "end";

type CfgBlock = {
  readonly id: string;
  readonly kind: CfgBlockKind;
};

type CfgEdgeKind =
  | "next"
  | "true"
  | "false"
  | "case"
  | "default"
  | "fallthrough"
  | "loop-back"
  | "break"
  | "continue"
  | "return"
  | "throw";

type CfgEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: CfgEdgeKind;
};

type Cfg = {
  readonly entry: string;
  readonly exit: string;
  /** In the order they were derived: entry first, exit last. */
  readonly blocks: readonly CfgBlock[];
  readonly edges: readonly CfgEdge[];
};

/** A compiled sequence: the block control enters, the blocks it may fall off. */
type Compiled = {
  readonly first: string;
  readonly exits: readonly string[];
};

type Builder = {
  readonly exit: string;
  readonly block: (id: string, kind: CfgBlockKind) => void;
  readonly edge: (from: string, to: string, kind: CfgEdgeKind) => void;
  readonly link: (
    exits: readonly string[],
    to: string,
    kind?: CfgEdgeKind
  ) => void;
};

const newBuilder = (exit: string, blocks: CfgBlock[], edges: CfgEdge[]) => {
  const seen = new Set<string>();
  const edge = (from: string, to: string, kind: CfgEdgeKind) => {
    const key = `${from}\n${to}\n${kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from, to, kind });
    }
  };
  const builder: Builder = {
    exit,
    block: (id, kind) => {
      blocks.push({ id, kind });
    },
    edge,
    link: (exits, to, kind = "next") => {
      for (const from of exits) {
        edge(from, to, kind);
      }
    },
  };
  return builder;
};

const jumpEdge = (jump: BreakNode | ContinueNode, b: Builder) => {
  const target = jumpTarget(jump);
  if (target !== null) {
    b.edge(jump.id, target, jump.kind);
  }
};

/** A way control leaves a node other than running on: a return or a jump. */
type Outcome =
  | { readonly kind: "return" | "throw" }
  | { readonly kind: "jump"; readonly jump: BreakNode | ContinueNode };

/** The parts of a `try` whose ways out count: a finalizer that ends overrides the rest. */
const tryParts = (node: TryNode): readonly SequenceNode[] =>
  node.finalizer !== null && isTerminal(node.finalizer)
    ? [node.finalizer]
    : [node.block, node.handler, node.finalizer].filter(
        (part) => part !== null
      );

/** Every return and jump under `node`, nested finalizers overriding theirs. */
const outcomesOf = (node: FlowNode): readonly Outcome[] => {
  switch (node.kind) {
    case "return": {
      return [{ kind: node.throws ? "throw" : "return" }];
    }
    case "break":
    case "continue": {
      return [{ kind: "jump", jump: node }];
    }
    case "try": {
      return tryParts(node).flatMap(outcomesOf);
    }
    case "sequence":
    case "branch":
    case "switch":
    case "loop":
    case "step":
    case "call":
    case "await":
    default: {
      return childrenOf(node).flatMap(outcomesOf);
    }
  }
};

/**
 * A `try` is one block with its ways out: its returns and throws, its jumps
 * to composites outside it, and running on unless the whole `try` ends.
 */
const tryEdges = (node: TryNode, b: Builder) => {
  const inside = new Set<string>();
  walkFlow(node, (current) => {
    inside.add(current.id);
  });
  for (const outcome of outcomesOf(node)) {
    if (outcome.kind !== "jump") {
      b.edge(node.id, b.exit, outcome.kind);
    } else if (!inside.has(outcome.jump.targetId)) {
      const target = jumpTarget(outcome.jump);
      if (target !== null) {
        b.edge(node.id, target, outcome.jump.kind);
      }
    }
  }
};

/** A lane, case or loop body: an empty one is a block of its own. */
const compileBody = (body: SequenceNode, b: Builder): Compiled => {
  if (body.steps.length === 0) {
    b.block(body.id, "empty");
    return { first: body.id, exits: [body.id] };
  }
  return compileSteps(body.steps, b);
};

const compileSwitch = (
  node: Extract<FlowStep, { kind: "switch" }>,
  merge: string,
  b: Builder
): readonly string[] => {
  const cases = node.cases.map((item) => compileBody(item.body, b));
  for (const [index, item] of node.cases.entries()) {
    const compiled = cases[index];
    if (compiled === undefined) {
      continue;
    }
    // Labels grouped on one body may hold cases and the default.
    if (item.labels.some((label) => label !== "default")) {
      b.edge(node.id, compiled.first, "case");
    }
    if (item.labels.includes("default")) {
      b.edge(node.id, compiled.first, "default");
    }
    const next = cases[index + 1];
    if (item.fallsThrough && next !== undefined) {
      b.link(compiled.exits, next.first, "fallthrough");
    } else {
      b.link(compiled.exits, merge);
    }
  }
  if (!node.cases.some((item) => item.labels.includes("default"))) {
    const fallback = taggedFlowNodeId(node.id, "default");
    b.block(fallback, "default");
    b.edge(node.id, fallback, "default");
    b.edge(fallback, merge, "next");
  }
  return [merge];
};

/** One step: its block (a composite's head first) and the blocks it may fall off. */
const compileStep = (node: FlowStep, b: Builder): Compiled => {
  b.block(node.id, node.kind);
  switch (node.kind) {
    case "return": {
      b.edge(node.id, b.exit, node.throws ? "throw" : "return");
      return { first: node.id, exits: [] };
    }
    case "break":
    case "continue": {
      jumpEdge(node, b);
      return { first: node.id, exits: [] };
    }
    case "branch": {
      const merge = taggedFlowNodeId(node.id, "merge");
      b.block(merge, "merge");
      const consequent = compileBody(node.consequent, b);
      const alternate = compileBody(node.alternate, b);
      b.edge(node.id, consequent.first, "true");
      b.edge(node.id, alternate.first, "false");
      b.link(consequent.exits, merge);
      b.link(alternate.exits, merge);
      return { first: node.id, exits: [merge] };
    }
    case "switch": {
      const merge = taggedFlowNodeId(node.id, "merge");
      b.block(merge, "merge");
      return { first: node.id, exits: compileSwitch(node, merge, b) };
    }
    case "loop": {
      const again = taggedFlowNodeId(node.id, "again");
      const end = taggedFlowNodeId(node.id, "end");
      b.block(again, "again");
      b.block(end, "end");
      const body = compileBody(node.body, b);
      if (node.loopKind === "do-while") {
        b.edge(node.id, body.first, "next");
      } else {
        b.edge(node.id, body.first, "true");
        // A loop tested first may not run at all.
        b.edge(node.id, end, "false");
      }
      b.link(body.exits, again);
      b.edge(again, node.id, "loop-back");
      b.edge(again, end, "false");
      return { first: node.id, exits: [end] };
    }
    case "try": {
      tryEdges(node, b);
      return { first: node.id, exits: isTerminal(node) ? [] : [node.id] };
    }
    case "step":
    case "call":
    case "await":
    default: {
      return { first: node.id, exits: [node.id] };
    }
  }
};

/** A non-empty run of steps, each falling into the next. */
const compileSteps = (steps: readonly FlowStep[], b: Builder): Compiled => {
  let first: string | null = null;
  let exits: readonly string[] = [];
  for (const step of steps) {
    const compiled = compileStep(step, b);
    b.link(exits, compiled.first);
    first ??= compiled.first;
    exits = compiled.exits;
  }
  return { first: first ?? "", exits };
};

/**
 * The control-flow graph of a function. Its entry leads into the first
 * block, returns and the end of the body into its exit. An empty body is one
 * `empty` block with the id of the room the layout gives it.
 */
const cfgOf = (fn: FunctionNode): Cfg => {
  const entry = `${fn.id}:entry`;
  const exit = `${fn.id}:exit`;
  const blocks: CfgBlock[] = [];
  const edges: CfgEdge[] = [];
  const b = newBuilder(exit, blocks, edges);
  b.block(entry, "entry");
  let body: Compiled;
  if (fn.flow.steps.length === 0) {
    const id = emptyBodySpec(fn).id;
    b.block(id, "empty");
    body = { first: id, exits: [id] };
  } else {
    body = compileSteps(fn.flow.steps, b);
  }
  b.edge(entry, body.first, "next");
  b.link(body.exits, exit);
  b.block(exit, "exit");
  return { entry, exit, blocks, edges };
};

/** Graphviz source for a CFG, one line per edge labelled with its kind. */
const toDot = (cfg: Cfg): string =>
  [
    "digraph cfg {",
    ...cfg.edges.map(
      (edge) =>
        `  ${JSON.stringify(edge.from)} -> ${JSON.stringify(edge.to)} [label=${JSON.stringify(edge.kind)}];`
    ),
    "}",
  ].join("\n");

export { cfgOf, toDot };
export type { Cfg, CfgBlock, CfgBlockKind, CfgEdge, CfgEdgeKind };
