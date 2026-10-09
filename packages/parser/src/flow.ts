// Flow pass: one function body as a tree of steps, calls, awaits, returns,
// branches, switches and loops in execution order. Runs after the call pass,
// so every statement can name the call sites inside it.

import {
  isBlockStatement,
  isBreakStatement,
  isContinueStatement,
  isIfStatement,
  isLabeledStatement,
  isReturnStatement,
  isSwitchStatement,
  isThrowStatement,
  isTryStatement,
} from "@babel/types";
import type {
  BlockStatement,
  BreakStatement,
  ContinueStatement,
  Node,
  ReturnStatement,
  Statement,
  ThrowStatement,
  TryStatement,
} from "@babel/types";
import type {
  BreakNode,
  CallSite,
  ContinueNode,
  FlowStep,
  ReturnNode,
  SequenceNode,
  TryNode,
} from "@repo/code-graph";
import { flowNodeId } from "@repo/code-graph/ids";

import { branchOf, loopOf, switchOf } from "./flow-composites";
import { isLoop, nested, sequenceNode } from "./flow-context";
import type { Built, FlowContext, Run } from "./flow-context";
import {
  isSkipped,
  leafOf,
  resolvedIds,
  sitesWithin,
  stepOf,
} from "./flow-leaves";
import type { FunctionLike } from "./scope";
import { spanOf } from "./span";
import { guardDepth } from "./walk";

const returnOf = (
  node: ReturnStatement | ThrowStatement,
  context: FlowContext
): ReturnNode => {
  const span = spanOf(node);
  return {
    id: flowNodeId(context.functionId, span.start, "return"),
    kind: "return",
    span,
    throws: isThrowStatement(node),
    callSiteIds: resolvedIds(sitesWithin(context.sites, span)),
  };
};

/**
 * `break` leaves the innermost target (or the labelled one), `continue` the
 * innermost loop. Null when nothing matches (a labelled block): the
 * statement then folds into a step.
 */
const jumpOf = (
  node: BreakStatement | ContinueStatement,
  context: FlowContext
): BreakNode | ContinueNode | null => {
  const span = spanOf(node);
  const label = node.label?.name ?? null;
  const isBreak = isBreakStatement(node);
  const target = context.targets.findLast((candidate) =>
    label === null
      ? isBreak || candidate.kind === "loop"
      : candidate.label === label
  );
  if (target === undefined) {
    return null;
  }
  if (isBreak) {
    context.broken.add(target.id);
  }
  return isBreak
    ? {
        id: flowNodeId(context.functionId, span.start, "break"),
        kind: "break",
        span,
        targetId: target.id,
      }
    : {
        id: flowNodeId(context.functionId, span.start, "continue"),
        kind: "continue",
        span,
        targetId: target.id,
      };
};

/**
 * `try`, `catch` and `finally` as three sequences owned by the statement.
 * It ends when the finalizer does, or when the block and the handler (if
 * any) both do.
 */
const tryOf = (node: TryStatement, context: FlowContext): Built => {
  const span = spanOf(node);
  const inner = nested(context);
  const part = (tag: string, block: BlockStatement) => {
    const run = context.run(block.body, inner);
    return {
      sequence: sequenceNode(
        flowNodeId(context.functionId, span.start, "sequence", tag),
        spanOf(block),
        run.steps
      ),
      terminal: run.terminal,
    };
  };
  const block = part("try", node.block);
  const handler =
    node.handler === null || node.handler === undefined
      ? null
      : part("catch", node.handler.body);
  const finalizer =
    node.finalizer === null || node.finalizer === undefined
      ? null
      : part("finally", node.finalizer);
  const tryNode: TryNode = {
    id: flowNodeId(context.functionId, span.start, "try"),
    kind: "try",
    span,
    block: block.sequence,
    handler: handler?.sequence ?? null,
    finalizer: finalizer?.sequence ?? null,
  };
  return {
    node: tryNode,
    terminal:
      finalizer?.terminal === true ||
      (block.terminal && (handler === null || handler.terminal)),
  };
};

type RunState = {
  readonly steps: FlowStep[];
  /** Plain statements waiting to fold into one step. */
  pending: Statement[];
  terminal: boolean;
};

const flush = (state: RunState, context: FlowContext): void => {
  const step = stepOf(state.pending, context);
  if (step !== null) {
    state.steps.push(step);
  }
  state.pending = [];
};

const push = (state: RunState, context: FlowContext, built: Built): void => {
  flush(state, context);
  state.steps.push(built.node);
  state.terminal = built.terminal;
};

/** A leaf ends the flow only when it is a jump. */
const leaf = (node: FlowStep): Built => ({
  node,
  terminal:
    node.kind === "return" || node.kind === "break" || node.kind === "continue",
});

const append = (state: RunState, context: FlowContext, run: Run): void => {
  flush(state, context);
  state.steps.push(...run.steps);
  state.terminal = run.terminal;
};

/** One statement into the run; composites recurse through `context.run`. */
const take = (
  state: RunState,
  context: FlowContext,
  statement: Statement
): void => {
  if (isBlockStatement(statement)) {
    append(state, context, context.run(statement.body, nested(context)));
  } else if (isTryStatement(statement)) {
    push(state, context, tryOf(statement, context));
  } else if (isIfStatement(statement)) {
    push(state, context, branchOf(statement, context));
  } else if (isSwitchStatement(statement)) {
    push(state, context, switchOf(statement, context, null));
  } else if (isLoop(statement)) {
    push(state, context, loopOf(statement, context, null));
  } else if (isLabeledStatement(statement)) {
    const { body } = statement;
    const label = statement.label.name;
    if (isSwitchStatement(body)) {
      push(state, context, switchOf(body, context, label));
    } else if (isLoop(body)) {
      push(state, context, loopOf(body, context, label));
    } else {
      append(state, context, context.run([body], nested(context)));
    }
  } else if (isReturnStatement(statement) || isThrowStatement(statement)) {
    push(state, context, leaf(returnOf(statement, context)));
  } else {
    const step =
      isBreakStatement(statement) || isContinueStatement(statement)
        ? jumpOf(statement, context)
        : leafOf(statement, context);
    if (step === null) {
      state.pending.push(statement);
    } else {
      push(state, context, leaf(step));
    }
  }
};

/**
 * Statements in order: plain ones fold into steps, composites recurse, and
 * nothing after a terminal step is kept (dead code).
 */
const runOf = (statements: readonly Statement[], context: FlowContext): Run => {
  guardDepth(context.depth);
  const state: RunState = { steps: [], pending: [], terminal: false };
  for (const statement of statements) {
    if (state.terminal) {
      break;
    }
    if (!isSkipped(statement, context.byNode)) {
      take(state, context, statement);
    }
  }
  flush(state, context);
  return { steps: state.steps, terminal: state.terminal };
};

type FlowInput = {
  readonly functionId: string;
  readonly node: FunctionLike;
  readonly source: string;
  readonly sites: readonly CallSite[];
  readonly byNode: ReadonlyMap<Node, unknown>;
};

/**
 * The body of one named function as a flow; an expression body is a return.
 * Calls in parameter defaults (`f(x = g())`) run first, so they open the
 * flow as one call step over the parameter list.
 */
const buildFlow = ({
  functionId,
  node,
  source,
  sites,
  byNode,
}: FlowInput): SequenceNode => {
  const context: FlowContext = {
    functionId,
    source,
    sites,
    byNode,
    targets: [],
    broken: new Set(),
    depth: 0,
    run: runOf,
  };
  const whole = spanOf(node);
  const { body } = node;
  const bodySpan = spanOf(body);
  const id = flowNodeId(functionId, whole.start, "sequence", "body");
  const params = { ...whole, end: bodySpan.start };
  const paramSites = resolvedIds(sitesWithin(sites, params));
  const head: FlowStep[] =
    paramSites.length === 0
      ? []
      : [
          {
            id: flowNodeId(functionId, whole.start, "call"),
            kind: "call",
            span: params,
            callSiteIds: paramSites,
          },
        ];
  if (isBlockStatement(body)) {
    return sequenceNode(id, bodySpan, [
      ...head,
      ...runOf(body.body, context).steps,
    ]);
  }
  return sequenceNode(id, bodySpan, [
    ...head,
    {
      id: flowNodeId(functionId, bodySpan.start, "return"),
      kind: "return",
      span: bodySpan,
      throws: false,
      callSiteIds: resolvedIds(sitesWithin(sites, bodySpan)),
    },
  ]);
};

export { buildFlow };
