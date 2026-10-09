import { describe, expect, it } from "vitest";

import type {
  BranchNode,
  FlowNode,
  FlowStep,
  LoopNode,
  ReturnNode,
  SequenceNode,
  SourceSpan,
  StepNode,
  SwitchCase,
  SwitchNode,
} from "./code-graph";
import { countStatements, isTerminal, walkFlow } from "./flow";

const span: SourceSpan = {
  start: 0,
  end: 1,
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 1,
};

let next = 0;
const id = (): string => {
  next += 1;
  return `t.ts::f@${next}:node`;
};

const seq = (steps: readonly FlowStep[]): SequenceNode => ({
  id: id(),
  kind: "sequence",
  span,
  steps,
});
const step = (statements: number): StepNode => ({
  id: id(),
  kind: "step",
  span,
  statements,
});
const ret = (): ReturnNode => ({
  id: id(),
  kind: "return",
  span,
  throws: false,
  callSiteIds: [],
});
const call = (): FlowStep => ({
  id: id(),
  kind: "call",
  span,
  callSiteIds: [],
});
const brk = (targetId: string): FlowStep => ({
  id: id(),
  kind: "break",
  span,
  targetId,
});
const branch = (
  consequent: SequenceNode,
  alternate: SequenceNode
): BranchNode => ({
  id: id(),
  kind: "branch",
  span,
  condition: "x",
  callSiteIds: [],
  consequent,
  alternate,
});
const loop = (body: SequenceNode): LoopNode => ({
  id: id(),
  kind: "loop",
  span,
  loopKind: "while",
  header: "while (x)",
  callSiteIds: [],
  body,
});
const sw = (switchId: string, cases: readonly SwitchCase[]): SwitchNode => ({
  id: switchId,
  kind: "switch",
  span,
  discriminant: "x",
  callSiteIds: [],
  cases,
});
const kase = (
  labels: readonly string[],
  body: SequenceNode,
  fallsThrough = false
): SwitchCase => ({ id: id(), span, labels, body, fallsThrough });

describe("isTerminal", () => {
  it("is true for jumps and for sequences ending in one", () => {
    expect(isTerminal(ret())).toBe(true);
    expect(isTerminal(brk("x"))).toBe(true);
    expect(isTerminal(seq([step(2), ret()]))).toBe(true);
    expect(isTerminal(seq([ret(), step(2)]))).toBe(false);
    expect(isTerminal(seq([]))).toBe(false);
    expect(isTerminal(step(3))).toBe(false);
    expect(isTerminal(call())).toBe(false);
  });

  it("needs both lanes of a branch to end", () => {
    expect(isTerminal(branch(seq([ret()]), seq([ret()])))).toBe(true);
    expect(isTerminal(branch(seq([ret()]), seq([])))).toBe(false);
    expect(isTerminal(branch(seq([call()]), seq([ret()])))).toBe(false);
  });

  it("never treats a loop as terminal", () => {
    expect(isTerminal(loop(seq([ret()])))).toBe(false);
  });

  it("ends a try by its finalizer, or by both its block and handler", () => {
    const tryNode = (
      block: SequenceNode,
      handler: SequenceNode | null,
      finalizer: SequenceNode | null
    ): FlowNode => ({ id: id(), kind: "try", span, block, handler, finalizer });
    expect(isTerminal(tryNode(seq([ret()]), null, null))).toBe(true);
    expect(isTerminal(tryNode(seq([ret()]), seq([call()]), null))).toBe(false);
    expect(isTerminal(tryNode(seq([ret()]), seq([ret()]), null))).toBe(true);
    expect(isTerminal(tryNode(seq([call()]), seq([ret()]), null))).toBe(false);
    expect(isTerminal(tryNode(seq([ret()]), null, seq([call()])))).toBe(true);
    expect(isTerminal(tryNode(seq([call()]), null, seq([ret()])))).toBe(true);
    expect(countStatements(tryNode(seq([step(2)]), seq([ret()]), null))).toBe(
      4
    );
  });

  it("judges a switch by default coverage, case endings and breaks", () => {
    const covered = sw("s", [
      kase(["case 1"], seq([ret()])),
      kase(["default"], seq([ret()])),
    ]);
    expect(isTerminal(covered)).toBe(true);
    const noDefault = sw("s", [
      kase(["case 1"], seq([ret()])),
      kase(["case 2"], seq([ret()])),
    ]);
    expect(isTerminal(noDefault)).toBe(false);
    const falling = sw("s", [
      kase(["case 1"], seq([call()]), true),
      kase(["default"], seq([ret()])),
    ]);
    expect(isTerminal(falling)).toBe(false);
    const broken = sw("s", [
      kase(["case 1"], seq([branch(seq([brk("s")]), seq([ret()]))])),
      kase(["default"], seq([ret()])),
    ]);
    expect(isTerminal(broken)).toBe(false);
    const innerBreak = sw("s", [
      kase(["case 1"], seq([branch(seq([brk("other")]), seq([ret()]))])),
      kase(["default"], seq([ret()])),
    ]);
    expect(isTerminal(innerBreak)).toBe(true);
  });
});

describe("countStatements", () => {
  it("counts folded steps by size and composites plus their children", () => {
    expect(countStatements(step(4))).toBe(4);
    expect(countStatements(seq([step(4), call(), ret()]))).toBe(6);
    expect(countStatements(branch(seq([step(2)]), seq([call()])))).toBe(4);
    expect(countStatements(loop(seq([])))).toBe(1);
    expect(
      countStatements(sw("s", [kase(["default"], seq([step(3), ret()]))]))
    ).toBe(5);
  });
});

describe("walkFlow", () => {
  it("visits in pre-order with the ancestors outermost first", () => {
    const inner = seq([ret()]);
    const root = seq([step(1), branch(inner, seq([]))]);
    const visited: [string, number][] = [];
    walkFlow(root, (node: FlowNode, ancestors) => {
      visited.push([node.kind, ancestors.length]);
    });
    expect(visited).toEqual([
      ["sequence", 0],
      ["step", 1],
      ["branch", 1],
      ["sequence", 2],
      ["return", 3],
      ["sequence", 2],
    ]);
  });
});
