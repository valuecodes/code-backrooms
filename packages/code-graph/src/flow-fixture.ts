// Hand-built flow trees for the template's tests: one function `m.ts::f`
// whose nodes are named by offset, with call sites to resolved callees
// `m.ts::g`, `m.ts::g1`, ... Spans are placeholders; only ids matter.

import type {
  BranchNode,
  CallSite,
  FlowStep,
  FunctionNode,
  LoopKind,
  SequenceNode,
  SourceSpan,
  SwitchCase,
} from "./code-graph";
import { layoutFlow, planFlow } from "./flow-layout";

const FN = "m.ts::f";

const span: SourceSpan = {
  start: 0,
  end: 10,
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 10,
};

const site = (offset: number, callee: string): CallSite => ({
  id: `${FN}@${offset}`,
  callerId: FN,
  calleeName: callee,
  calleeId: `m.ts::${callee}`,
  resolution: "resolved",
  kind: "call",
  awaited: false,
  span: { ...span, start: offset, end: offset + 3 },
});

const step = (offset: number, statements: number): FlowStep => ({
  id: `${FN}@${offset}:step`,
  kind: "step",
  span,
  statements,
});

const call = (offset: number, callSiteIds: readonly string[]): FlowStep => ({
  id: `${FN}@${offset}:call`,
  kind: "call",
  span,
  callSiteIds,
});

const ret = (
  offset: number,
  callSiteIds: readonly string[] = []
): FlowStep => ({
  id: `${FN}@${offset}:return`,
  kind: "return",
  span,
  throws: false,
  callSiteIds,
});

/** An await of something unresolved: no site lies in its span. */
const awaitNode = (offset: number): FlowStep => ({
  id: `${FN}@${offset}:await`,
  kind: "await",
  span: { ...span, start: 900, end: 910 },
  callSiteIds: [],
});

const sequence = (
  offset: number,
  tag: string,
  steps: readonly FlowStep[]
): SequenceNode => ({
  id: `${FN}@${offset}:sequence:${tag}`,
  kind: "sequence",
  span,
  steps,
});

/** `if (x) { ...then } else { ...otherwise }`, with calls in the condition. */
const branch = (
  offset: number,
  then: readonly FlowStep[],
  otherwise: readonly FlowStep[] = [],
  callSiteIds: readonly string[] = []
): BranchNode => ({
  id: `${FN}@${offset}:branch`,
  kind: "branch",
  span,
  condition: "x",
  callSiteIds,
  consequent: sequence(offset, "then", then),
  alternate: sequence(offset, "else", otherwise),
});

type CaseSpec = {
  readonly labels: readonly string[];
  readonly body: readonly FlowStep[];
  readonly fallsThrough?: boolean;
};

/** `switch (x)` whose cases start at `offset + 1`, `offset + 2`, ... */
const switchNode = (offset: number, cases: readonly CaseSpec[]): FlowStep => ({
  id: `${FN}@${offset}:switch`,
  kind: "switch",
  span,
  discriminant: "x",
  callSiteIds: [],
  cases: cases.map((item, index): SwitchCase => ({
    id: `${FN}@${offset + index + 1}:case`,
    span,
    labels: item.labels,
    body: sequence(offset + index + 1, "case", item.body),
    fallsThrough: item.fallsThrough ?? false,
  })),
});

const loop = (
  offset: number,
  body: readonly FlowStep[],
  loopKind: LoopKind = "while"
): FlowStep => ({
  id: `${FN}@${offset}:loop`,
  kind: "loop",
  span,
  loopKind,
  header: "while (x)",
  callSiteIds: [],
  body: sequence(offset, "loop", body),
});

const breakOut = (offset: number, targetId: string): FlowStep => ({
  id: `${FN}@${offset}:break`,
  kind: "break",
  span,
  targetId,
});

const fnWith = (steps: readonly FlowStep[]): FunctionNode => ({
  id: FN,
  moduleId: "m.ts",
  name: "f",
  qualifiedName: "f",
  kind: "declaration",
  span,
  exported: false,
  async: false,
  isStatic: false,
  parentId: null,
  className: null,
  flow: { id: `${FN}@0:sequence:body`, kind: "sequence", span, steps },
});

/** A room calling `count` distinct functions g1..gN from one statement. */
const calling = (offset: number, count: number) => {
  const sites = Array.from({ length: count }, (_, index) =>
    site(offset + index, `g${index + 1}`)
  );
  return {
    node: call(
      offset,
      sites.map((item) => item.id)
    ),
    sites,
  };
};

/** The cluster for a body, every callee a plain 4 m column unless `widthOf` says otherwise. */
const clusterOf = (
  steps: readonly FlowStep[],
  sites: readonly CallSite[] = [],
  widthOf?: (unitId: string) => number
) => layoutFlow(planFlow(fnWith(steps), sites), widthOf);

export {
  awaitNode,
  branch,
  breakOut,
  call,
  calling,
  clusterOf,
  FN,
  fnWith,
  loop,
  ret,
  site,
  step,
  switchNode,
};
