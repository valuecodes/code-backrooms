// Branches, switches and loops: composites whose bodies are runs of their
// own, built through the walker the context carries. Each comes back with
// its terminality, worked out from its runs so nothing is walked twice.

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
import { flowNodeId } from "@repo/code-graph/ids";

import {
  headSites,
  loopKindOf,
  nested,
  sequenceNode,
  slice,
} from "./flow-context";
import type { Built, FlowContext, Loop, Run } from "./flow-context";
import { textOf } from "./flow-leaves";
import { spanOf } from "./span";

const branchOf = (node: IfStatement, context: FlowContext): Built => {
  const span = spanOf(node);
  const test = spanOf(node.test);
  const inner = nested(context);
  const lane = (
    tag: string,
    body: Statement | null | undefined
  ): { readonly sequence: SequenceNode; readonly terminal: boolean } => {
    const id = flowNodeId(context.functionId, span.start, "sequence", tag);
    if (body === null || body === undefined) {
      return { sequence: sequenceNode(id, span, []), terminal: false };
    }
    const run = context.run([body], inner);
    return {
      sequence: sequenceNode(id, spanOf(body), run.steps),
      terminal: run.terminal,
    };
  };
  const consequent = lane("then", node.consequent);
  const alternate = lane("else", node.alternate);
  const branch: BranchNode = {
    id: flowNodeId(context.functionId, span.start, "branch"),
    kind: "branch",
    span,
    condition: slice(context, test),
    callSiteIds: headSites(context, test),
    consequent: consequent.sequence,
    alternate: alternate.sequence,
  };
  return { node: branch, terminal: consequent.terminal && alternate.terminal };
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

/**
 * A switch ends when it covers `default`, every case ends (a case that
 * falls through ends when the next one does) and no `break` inside its
 * cases leaves it (`context.broken` collects those as the bodies are built).
 */
const switchOf = (
  node: SwitchStatement,
  context: FlowContext,
  label: string | null
): Built => {
  const span = spanOf(node);
  const id = flowNodeId(context.functionId, span.start, "switch");
  const inner = nested(context, { id, kind: "switch", label });
  const discriminant = spanOf(node.discriminant);
  const cases: SwitchCase[] = [];
  // The calls in the case tests count as the switch's own, like the discriminant's.
  const testSites: string[] = [];
  let hasDefault = false;
  // Whether each case ends, in order; a case that falls through ends when
  // the next one does, so this is settled from the back once all are built.
  const caseEnds: {
    readonly terminal: boolean;
    readonly fallsThrough: boolean;
  }[] = [];
  // Empty cases merge into the next one with a body, keeping their labels.
  let labels: string[] = [];
  let first: SourceSpan | null = null;
  for (const [index, item] of node.cases.entries()) {
    const caseSpan = spanOf(item);
    first ??= caseSpan;
    const { test } = item;
    if (test === null || test === undefined) {
      hasDefault = true;
      labels.push("default");
    } else {
      testSites.push(...headSites(context, spanOf(test)));
      labels.push(`case ${slice(context, spanOf(test))}`);
    }
    const last = index === node.cases.length - 1;
    if (item.consequent.length === 0 && !last) {
      continue;
    }
    const { statements, broke } = caseBody(item.consequent, label);
    const run: Run = context.run(statements, inner);
    const fallsThrough = !broke && !last && !run.terminal;
    caseEnds.push({ terminal: run.terminal, fallsThrough });
    cases.push({
      id: flowNodeId(context.functionId, caseSpan.start, "case"),
      span: {
        ...first,
        end: caseSpan.end,
        endLine: caseSpan.endLine,
        endColumn: caseSpan.endColumn,
      },
      labels,
      body: sequenceNode(
        flowNodeId(context.functionId, caseSpan.start, "sequence", "case"),
        caseSpan,
        run.steps
      ),
      fallsThrough,
    });
    labels = [];
    first = null;
  }
  const node_: SwitchNode = {
    id,
    kind: "switch",
    span,
    discriminant: slice(context, discriminant),
    callSiteIds: [...headSites(context, discriminant), ...testSites],
    cases,
  };
  let ends = true;
  let nextEnds = false;
  for (const item of caseEnds.reverse()) {
    nextEnds = item.terminal || (item.fallsThrough && nextEnds);
    ends &&= nextEnds;
  }
  return {
    node: node_,
    terminal: hasDefault && ends && !context.broken.has(id),
  };
};

/**
 * A do-while runs its body once, so it ends when the body does and no
 * `break` or `continue` targets it; any other loop may not run at all.
 */
const loopOf = (
  node: Loop,
  context: FlowContext,
  label: string | null
): Built => {
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
  const run = context.run(
    [node.body],
    nested(context, { id, kind: "loop", label })
  );
  const loop: LoopNode = {
    id,
    kind: "loop",
    span,
    loopKind,
    header,
    callSiteIds: headSites(context, span, body),
    body: sequenceNode(
      flowNodeId(context.functionId, span.start, "sequence", "loop"),
      body,
      run.steps
    ),
  };
  return {
    node: loop,
    terminal:
      loopKind === "do-while" &&
      run.terminal &&
      !context.broken.has(id) &&
      !context.continued.has(id),
  };
};

export { branchOf, loopOf, switchOf };
