// What the flow pass carries while it walks: the function, its call sites,
// the enclosing jump targets, and the run function the composites recurse
// through (handed over in the context so the files stay acyclic).

import {
  isDoWhileStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isWhileStatement,
} from "@babel/types";
import type {
  DoWhileStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Node,
  Statement,
  WhileStatement,
} from "@babel/types";
import type {
  CallSite,
  FlowStep,
  LoopKind,
  SequenceNode,
  SourceSpan,
} from "@repo/code-graph";

import { resolvedIds, sitesWithin, textOf } from "./flow-leaves";

/** An enclosing loop or switch a `break`/`continue` may name. */
type Target = {
  readonly id: string;
  readonly kind: "loop" | "switch";
  readonly label: string | null;
};

/** Statements in order, as flow steps. */
type Run = {
  readonly steps: readonly FlowStep[];
  /** Control never reaches past the last step. */
  readonly terminal: boolean;
};

/** A composite step with its terminality, known from the runs it was built from. */
type Built = {
  readonly node: FlowStep;
  readonly terminal: boolean;
};

type FlowContext = {
  readonly functionId: string;
  readonly source: string;
  /** This function's call sites, in source order. */
  readonly sites: readonly CallSite[];
  /** Nodes that are rooms of their own; their statements are not ours. */
  readonly byNode: ReadonlyMap<Node, unknown>;
  /** Innermost last. */
  readonly targets: readonly Target[];
  /** Ids of the loops and switches a `break` leaves; shared by every level. */
  readonly broken: Set<string>;
  /** Ids of the loops a `continue` restarts. */
  readonly continued: Set<string>;
  readonly depth: number;
  /** The statement walker, for composites to build their bodies with. */
  readonly run: (statements: readonly Statement[], context: FlowContext) => Run;
};

type Loop =
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForOfStatement
  | ForInStatement;

const isLoop = (node: Node): node is Loop =>
  isWhileStatement(node) ||
  isDoWhileStatement(node) ||
  isForStatement(node) ||
  isForOfStatement(node) ||
  isForInStatement(node);

const loopKindOf = (node: Loop): LoopKind => {
  if (isWhileStatement(node)) {
    return "while";
  }
  if (isDoWhileStatement(node)) {
    return "do-while";
  }
  if (isForStatement(node)) {
    return "for";
  }
  return isForOfStatement(node) ? "for-of" : "for-in";
};

/** One level deeper, optionally inside a new jump target. */
const nested = (context: FlowContext, target?: Target): FlowContext => ({
  ...context,
  targets:
    target === undefined ? context.targets : [...context.targets, target],
  depth: context.depth + 1,
});

/** Resolved call sites in `span`, minus those inside `exclude` (a body). */
const headSites = (
  context: FlowContext,
  span: SourceSpan,
  exclude?: SourceSpan
): readonly string[] =>
  resolvedIds(
    sitesWithin(context.sites, span).filter(
      (site) =>
        exclude === undefined ||
        site.span.start < exclude.start ||
        site.span.end > exclude.end
    )
  );

const slice = (context: FlowContext, span: SourceSpan): string =>
  textOf(context.source, span.start, span.end);

const sequenceNode = (
  id: string,
  span: SourceSpan,
  steps: readonly FlowStep[]
): SequenceNode => ({ id, kind: "sequence", span, steps });

export { headSites, isLoop, loopKindOf, nested, sequenceNode, slice };
export type { Built, FlowContext, Loop, Run };
