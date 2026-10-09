// The leaves of the flow pass: what a plain statement is (a call, an await,
// or just a statement), the call sites inside a span, and source text for
// labels. Nothing here recurses into statements; flow.ts does that.

import {
  isAwaitExpression,
  isDeclaration,
  isEmptyStatement,
  isVariableDeclaration,
} from "@babel/types";
import type { Node, Statement } from "@babel/types";
import type {
  AwaitNode,
  CallNode,
  CallSite,
  SourceSpan,
  StepNode,
} from "@repo/code-graph";
import { flowNodeId } from "@repo/code-graph/ids";

import { isFunctionLike } from "./scope";
import { spanOf } from "./span";
import { childrenOf, guardDepth } from "./walk";

/** Labels stay readable in a HUD line. */
const TEXT_LIMIT = 60;

/** A source slice with its whitespace collapsed, cut with an ellipsis. */
const textOf = (source: string, start: number, end: number): string => {
  const text = source.slice(start, end).replaceAll(/\s+/g, " ").trim();
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
};

/**
 * The call sites lying inside a span, by offsets (sites carry no AST node).
 * Sites come sorted by start, so the first candidate is found by bisection
 * and the scan stops at the first one starting past the span.
 */
const sitesWithin = (
  sites: readonly CallSite[],
  span: SourceSpan
): readonly CallSite[] => {
  let lo = 0;
  let hi = sites.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sites[mid]?.span.start ?? Infinity) < span.start) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const within: CallSite[] = [];
  for (let index = lo; index < sites.length; index += 1) {
    const site = sites[index];
    if (site === undefined || site.span.start > span.end) {
      break;
    }
    if (site.span.end <= span.end) {
      within.push(site);
    }
  }
  return within;
};

const resolvedIds = (sites: readonly CallSite[]): readonly string[] =>
  sites.filter((site) => site.resolution === "resolved").map((site) => site.id);

/** Whether an `await` sits in the node outside any nested function. */
const containsAwait = (node: Node, depth = 0): boolean => {
  guardDepth(depth);
  if (isAwaitExpression(node)) {
    return true;
  }
  if (isFunctionLike(node)) {
    return false;
  }
  return childrenOf(node).some((child) => containsAwait(child, depth + 1));
};

/**
 * A declaration whose every initialiser is itself a room (`const f = () =>
 * {}`): its body is that room's flow, so the declaration is not a step here.
 */
const isRoomDeclaration = (
  statement: Statement,
  byNode: ReadonlyMap<Node, unknown>
): boolean =>
  isVariableDeclaration(statement) &&
  statement.declarations.every(
    ({ init }) => init !== null && init !== undefined && byNode.has(init)
  );

/**
 * Statements that are not steps of the flow: function, class and type
 * declarations (their bodies are other rooms, or nothing runs), empty
 * statements, and room declarations. `import`/`export` cannot occur in a
 * body.
 */
const isSkipped = (
  statement: Statement,
  byNode: ReadonlyMap<Node, unknown>
): boolean =>
  (isDeclaration(statement) && !isVariableDeclaration(statement)) ||
  isEmptyStatement(statement) ||
  isRoomDeclaration(statement, byNode);

type LeafContext = {
  readonly functionId: string;
  readonly sites: readonly CallSite[];
};

/**
 * What a plain statement becomes: an await checkpoint when it awaits
 * anything, a call when it holds a resolved call (callbacks included), or
 * null when it is just a statement to fold into a step.
 */
const leafOf = (
  statement: Statement,
  context: LeafContext
): AwaitNode | CallNode | null => {
  const span = spanOf(statement);
  const callSiteIds = resolvedIds(sitesWithin(context.sites, span));
  if (containsAwait(statement)) {
    return {
      id: flowNodeId(context.functionId, span.start, "await"),
      kind: "await",
      span,
      callSiteIds,
    };
  }
  if (callSiteIds.length > 0) {
    return {
      id: flowNodeId(context.functionId, span.start, "call"),
      kind: "call",
      span,
      callSiteIds,
    };
  }
  return null;
};

/** Plain statements folded into one step spanning the first to the last. */
const stepOf = (
  statements: readonly Statement[],
  context: LeafContext
): StepNode | null => {
  const first = statements[0];
  const last = statements.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const head = spanOf(first);
  const tail = spanOf(last);
  return {
    id: flowNodeId(context.functionId, head.start, "step"),
    kind: "step",
    span: {
      ...head,
      end: tail.end,
      endLine: tail.endLine,
      endColumn: tail.endColumn,
    },
    statements: statements.length,
  };
};

export { isSkipped, leafOf, resolvedIds, sitesWithin, stepOf, textOf };
