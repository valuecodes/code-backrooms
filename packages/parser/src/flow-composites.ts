// Branches, switches and loops: composites whose bodies are runs of their
// own, built through the walker the context carries.

import { isBreakStatement } from "@babel/types";
import type { IfStatement, Statement, SwitchStatement } from "@babel/types";
import type {
  BranchNode,
  LoopNode,
  SequenceNode,
  SourceSpan,
  SwitchCase,
  SwitchNode,
} from "@repo/code-graph";
import { isTerminal } from "@repo/code-graph/flow";
import { flowNodeId } from "@repo/code-graph/ids";

import {
  headSites,
  loopKindOf,
  nested,
  sequenceNode,
  slice,
} from "./flow-context";
import type { FlowContext, Loop } from "./flow-context";
import { textOf } from "./flow-leaves";
import { spanOf } from "./span";

const branchOf = (node: IfStatement, context: FlowContext): BranchNode => {
  const span = spanOf(node);
  const test = spanOf(node.test);
  const inner = nested(context);
  const lane = (
    tag: string,
    body: Statement | null | undefined
  ): SequenceNode => {
    const id = flowNodeId(context.functionId, span.start, "sequence", tag);
    return body === null || body === undefined
      ? sequenceNode(id, span, [])
      : sequenceNode(id, spanOf(body), context.run([body], inner).steps);
  };
  return {
    id: flowNodeId(context.functionId, span.start, "branch"),
    kind: "branch",
    span,
    condition: slice(context, test),
    callSiteIds: headSites(context, test),
    consequent: lane("then", node.consequent),
    alternate: lane("else", node.alternate),
  };
};

/** A case body without its trailing `break` out of this switch. */
const caseBody = (
  statements: readonly Statement[],
  label: string | null
): { readonly statements: readonly Statement[]; readonly broke: boolean } => {
  const last = statements.at(-1);
  const broke =
    last !== undefined &&
    isBreakStatement(last) &&
    (last.label === null ||
      last.label === undefined ||
      last.label.name === label);
  return { statements: broke ? statements.slice(0, -1) : statements, broke };
};

const switchOf = (
  node: SwitchStatement,
  context: FlowContext,
  label: string | null
): SwitchNode => {
  const span = spanOf(node);
  const id = flowNodeId(context.functionId, span.start, "switch");
  const inner = nested(context, { id, kind: "switch", label });
  const discriminant = spanOf(node.discriminant);
  const cases: SwitchCase[] = [];
  // Empty cases merge into the next one with a body, keeping their labels.
  let labels: string[] = [];
  let first: SourceSpan | null = null;
  for (const [index, item] of node.cases.entries()) {
    const caseSpan = spanOf(item);
    first ??= caseSpan;
    const { test } = item;
    labels.push(
      test === null || test === undefined
        ? "default"
        : `case ${slice(context, spanOf(test))}`
    );
    const last = index === node.cases.length - 1;
    if (item.consequent.length === 0 && !last) {
      continue;
    }
    const { statements, broke } = caseBody(item.consequent, label);
    const body = sequenceNode(
      flowNodeId(context.functionId, caseSpan.start, "sequence", "case"),
      caseSpan,
      context.run(statements, inner).steps
    );
    cases.push({
      id: flowNodeId(context.functionId, caseSpan.start, "case"),
      span: {
        ...first,
        end: caseSpan.end,
        endLine: caseSpan.endLine,
        endColumn: caseSpan.endColumn,
      },
      labels,
      body,
      fallsThrough: !broke && !last && !isTerminal(body),
    });
    labels = [];
    first = null;
  }
  return {
    id,
    kind: "switch",
    span,
    discriminant: slice(context, discriminant),
    callSiteIds: headSites(context, discriminant),
    cases,
  };
};

const loopOf = (
  node: Loop,
  context: FlowContext,
  label: string | null
): LoopNode => {
  const span = spanOf(node);
  const body = spanOf(node.body);
  const id = flowNodeId(context.functionId, span.start, "loop");
  const loopKind = loopKindOf(node);
  // `while (x)` after the body for do-while, without the `;`.
  const end = context.source.endsWith(";", span.end) ? span.end - 1 : span.end;
  const header =
    loopKind === "do-while"
      ? textOf(context.source, body.end, end)
      : textOf(context.source, span.start, body.start);
  return {
    id,
    kind: "loop",
    span,
    loopKind,
    header,
    callSiteIds: headSites(context, span, body),
    body: sequenceNode(
      flowNodeId(context.functionId, span.start, "sequence", "loop"),
      body,
      context.run([node.body], nested(context, { id, kind: "loop", label }))
        .steps
    ),
  };
};

export { branchOf, loopOf, switchOf };
