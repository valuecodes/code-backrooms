import type { FlowNode, SequenceNode, SwitchNode } from "@repo/code-graph";
import { walkFlow } from "@repo/code-graph/flow";
import { parseFlowNodeId } from "@repo/code-graph/ids";
import { describe, expect, it } from "vitest";

import { parseModule } from "./parser";

const parse = (source: string, path = "t.ts") => parseModule({ path, source });

const flowOf = (source: string, name = "f"): SequenceNode => {
  const fn = parse(source).functions.find(
    (candidate) => candidate.qualifiedName === name
  );
  if (fn === undefined) {
    throw new Error(`no function ${name}`);
  }
  return fn.flow;
};

const kinds = (sequence: SequenceNode): readonly string[] =>
  sequence.steps.map((step) => step.kind);

const stepAt = <K extends FlowNode["kind"]>(
  sequence: SequenceNode,
  index: number,
  kind: K
): Extract<FlowNode, { kind: K }> => {
  const step = sequence.steps[index];
  if (step === undefined || step.kind !== kind) {
    throw new Error(`step ${index} is ${step?.kind ?? "missing"}, not ${kind}`);
  }
  return step as Extract<FlowNode, { kind: K }>;
};

const HELPERS = "function a() {}\nfunction b() {}\nfunction c() {}\n";

describe("sequences and steps", () => {
  it("names the body after the function and spans the block", () => {
    const flow = flowOf("function f() {}");
    expect(flow).toMatchObject({
      id: "t.ts::f@0:sequence:body",
      kind: "sequence",
      steps: [],
      span: { start: 13, end: 15 },
    });
  });

  it("folds plain statements into one step spanning them", () => {
    const flow = flowOf("function f() { const a = 1; const b = 2; a + b; }");
    expect(kinds(flow)).toEqual(["step"]);
    expect(stepAt(flow, 0, "step")).toMatchObject({
      id: "t.ts::f@15:step",
      statements: 3,
      span: { start: 15, end: 47 },
    });
  });

  it("skips declarations that are rooms or never run", () => {
    const flow = flowOf(
      [
        "function f() {",
        "  function g() { a(); }",
        "  const h = () => a();",
        "  type T = string;",
        "  interface I { x: T }",
        "  class K { m() { a(); } }",
        "  ;",
        "  a();",
        "}",
        HELPERS,
      ].join("\n")
    );
    expect(kinds(flow)).toEqual(["call"]);
    const nested = flowOf(
      `function f() { function g() { a(); } }\n${HELPERS}`,
      "f.g"
    );
    expect(kinds(nested)).toEqual(["call"]);
  });
});

describe("calls and awaits", () => {
  const source = [
    "function load() { return 1; }",
    "function parse(x: number) { return x; }",
    "async function f(xs: number[]) {",
    "  unknown();",
    "  load();",
    "  await fetch('/');",
    "  const r = await load();",
    "  xs.map((x) => parse(x));",
    "  const n = 1, g = () => {};",
    "  return await load();",
    "}",
  ].join("\n");

  it("tells steps, calls, awaits and returns apart", () => {
    const flow = flowOf(source);
    expect(kinds(flow)).toEqual([
      "step",
      "call",
      "await",
      "await",
      "call",
      "step",
      "return",
    ]);
  });

  it("gives awaits and returns the resolved sites inside them", () => {
    const flow = flowOf(source);
    expect(stepAt(flow, 2, "await").callSiteIds).toEqual([]);
    expect(stepAt(flow, 3, "await").callSiteIds).toEqual([
      expect.stringMatching(/^t\.ts::f@\d+$/),
    ]);
    expect(stepAt(flow, 4, "call").callSiteIds).toHaveLength(1);
    expect(stepAt(flow, 6, "return")).toMatchObject({
      throws: false,
      callSiteIds: [expect.stringMatching(/^t\.ts::f@\d+$/)],
    });
  });

  it("treats an expression-bodied arrow as one return", () => {
    const flow = flowOf(
      "const f = (x: number) => g(x);\nfunction g(x: number) { return x; }"
    );
    expect(flow.id).toBe("t.ts::f@10:sequence:body");
    expect(flow.span).toMatchObject({ start: 25, end: 29 });
    expect(flow.steps).toEqual([
      expect.objectContaining({
        kind: "return",
        id: "t.ts::f@25:return",
        callSiteIds: ["t.ts::f@25"],
      }),
    ]);
  });

  it("walks class member bodies", () => {
    const source = [
      "class S {",
      "  constructor() { this.n(); this.n(); }",
      "  get v() { return 1; }",
      "  m() { this.n(); }",
      "  n() {}",
      "  h = () => { this.n(); };",
      "}",
    ].join("\n");
    expect(kinds(flowOf(source, "S.constructor"))).toEqual(["call", "call"]);
    expect(kinds(flowOf(source, "S.v"))).toEqual(["return"]);
    expect(kinds(flowOf(source, "S.m"))).toEqual(["call"]);
    expect(kinds(flowOf(source, "S.n"))).toEqual([]);
    expect(kinds(flowOf(source, "S.h"))).toEqual(["call"]);
  });
});

describe("returns and dead code", () => {
  it("drops statements after a return and marks throws", () => {
    const flow = flowOf(`function f() { return a(); b(); }\n${HELPERS}`);
    expect(kinds(flow)).toEqual(["return"]);
    expect(stepAt(flow, 0, "return").callSiteIds).toHaveLength(1);
    const thrown = flowOf('function f() { throw new Error("x"); }');
    expect(stepAt(thrown, 0, "return").throws).toBe(true);
  });

  it("keeps a try as one node whose block, handler and finalizer are lanes", () => {
    const finalized = flowOf(
      `function f() { try { return a(); } finally { b(); } c(); }\n${HELPERS}`
    );
    expect(kinds(finalized)).toEqual(["try"]);
    const node = stepAt(finalized, 0, "try");
    expect(node.id).toBe("t.ts::f@15:try");
    expect(kinds(node.block)).toEqual(["return"]);
    expect(node.handler).toBeNull();
    expect(kinds(node.finalizer ?? node.block)).toEqual(["call"]);
    expect(node.block.id).toBe("t.ts::f@15:sequence:try");
    expect(node.finalizer?.id).toBe("t.ts::f@15:sequence:finally");
    const caught = flowOf(
      `function f() { try { return a(); } catch (e) { b(); } c(); }\n${HELPERS}`
    );
    expect(kinds(caught)).toEqual(["try", "call"]);
  });

  it("does not let a caught return end an enclosing branch", () => {
    const flow = flowOf(
      `function f(x: boolean) { if (x) { try { a(); } catch { return; } } else { return; } b(); }\n${HELPERS}`
    );
    expect(kinds(flow)).toEqual(["branch", "call"]);
  });

  it("opens the flow with the calls in parameter defaults", () => {
    const flow = flowOf(`function f(x = a()) { return x; }\n${HELPERS}`);
    expect(kinds(flow)).toEqual(["call", "return"]);
    expect(stepAt(flow, 0, "call")).toMatchObject({
      id: "t.ts::f@0:call",
      callSiteIds: ["t.ts::f@15"],
      span: { start: 0, end: 20 },
    });
    const arrow = flowOf(`const f = (x = a()) => x;\n${HELPERS}`);
    expect(kinds(arrow)).toEqual(["call", "return"]);
  });
});

describe("branches", () => {
  const source = [
    "function f(u: boolean) {",
    "  if (u) { a(); } else { b(); }",
    "  if (u) return;",
    "  if (a()) { a(); } else if (!u) { b(); }",
    "  c();",
    "}",
    HELPERS,
  ].join("\n");

  it("builds lanes, an empty else and nested else-if", () => {
    const flow = flowOf(source);
    expect(kinds(flow)).toEqual(["branch", "branch", "branch", "call"]);
    const first = stepAt(flow, 0, "branch");
    expect(first).toMatchObject({
      id: "t.ts::f@27:branch",
      condition: "u",
      callSiteIds: [],
      consequent: { id: "t.ts::f@27:sequence:then" },
      alternate: { id: "t.ts::f@27:sequence:else" },
    });
    expect(kinds(first.consequent)).toEqual(["call"]);
    expect(kinds(first.alternate)).toEqual(["call"]);
    const second = stepAt(flow, 1, "branch");
    expect(kinds(second.consequent)).toEqual(["return"]);
    expect(second.alternate.steps).toEqual([]);
    expect(second.alternate.span).toEqual(second.span);
    const third = stepAt(flow, 2, "branch");
    expect(third.callSiteIds).toHaveLength(1);
    expect(kinds(third.alternate)).toEqual(["branch"]);
    expect(stepAt(third.alternate, 0, "branch").alternate.steps).toEqual([]);
  });

  it("gives every node a unique id that parses back to the function", () => {
    const ids: string[] = [];
    walkFlow(flowOf(source), (node) => {
      ids.push(node.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.map((item) => parseFlowNodeId(item)?.functionId)).toEqual(
      ids.map(() => "t.ts::f")
    );
  });
});

describe("switches", () => {
  const source = [
    "function f(s: string) {",
    "  switch (s) {",
    "    case 'a':",
    "    case 'b':",
    "      a();",
    "      break;",
    "    case 'c':",
    "      b();",
    "    case 'd':",
    "      if (s) { break; }",
    "      c();",
    "      break;",
    "    default:",
    "      return;",
    "  }",
    "  a();",
    "}",
    HELPERS,
  ].join("\n");

  const switchOf = (text: string): SwitchNode =>
    stepAt(flowOf(text), 0, "switch");

  it("merges empty cases, drops trailing breaks and marks fallthrough", () => {
    const node = switchOf(source);
    expect(node).toMatchObject({ discriminant: "s", callSiteIds: [] });
    expect(
      node.cases.map((item) => [
        item.labels,
        kinds(item.body),
        item.fallsThrough,
      ])
    ).toEqual([
      [["case 'a'", "case 'b'"], ["call"], false],
      [["case 'c'"], ["call"], true],
      [["case 'd'"], ["branch", "call"], false],
      [["default"], ["return"], false],
    ]);
    const merged = node.cases[0];
    expect(merged?.id).toMatch(/:case$/);
    expect(merged?.body.id).toMatch(/:sequence:case$/);
    expect(merged?.span.start).toBeLessThan(merged?.body.span.start ?? 0);
  });

  it("targets the switch from a break inside a case and keeps code after it", () => {
    const flow = flowOf(source);
    expect(kinds(flow)).toEqual(["switch", "call"]);
    const node = stepAt(flow, 0, "switch");
    const lane = node.cases[2]?.body;
    expect(lane).toBeDefined();
    const branch = stepAt(lane ?? node.cases[0]?.body ?? flow, 0, "branch");
    expect(stepAt(branch.consequent, 0, "break").targetId).toBe(node.id);
  });

  it("counts the calls in case tests as the switch's own", () => {
    const flow = flowOf(
      `function f(s: number) { switch (s) { case a(): break; case b(): case c(): break; } }\n${HELPERS}`
    );
    expect(stepAt(flow, 0, "switch").callSiteIds).toEqual([
      expect.stringMatching(/^t\.ts::f@\d+$/),
      expect.stringMatching(/^t\.ts::f@\d+$/),
      expect.stringMatching(/^t\.ts::f@\d+$/),
    ]);
  });

  it("ends through a case that falls into a terminal one", () => {
    const flow = flowOf(
      `function f(s: number) { switch (s) { case 1: a(); default: return; } b(); }\n${HELPERS}`
    );
    expect(kinds(flow)).toEqual(["switch"]);
  });

  it("is terminal only with a default and no way out", () => {
    const open = flowOf(
      "function f(s: string) { switch (s) { case 'a': return 1; case 'b': return 2; } return 3; }"
    );
    expect(kinds(open)).toEqual(["switch", "return"]);
    const closed = flowOf(
      `function f(s: string) { switch (s) { default: return 0; case 'a': return 1; } a(); }\n${HELPERS}`
    );
    expect(kinds(closed)).toEqual(["switch"]);
    expect(
      stepAt(closed, 0, "switch").cases.map((item) => item.labels)
    ).toEqual([["default"], ["case 'a'"]]);
  });
});
