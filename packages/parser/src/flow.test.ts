import type { FlowNode, SequenceNode, SwitchNode } from "@repo/code-graph";
import { walkFlow } from "@repo/code-graph/flow";
import { parseFlowNodeId } from "@repo/code-graph/ids";
import { describe, expect, it } from "vitest";

import { textOf } from "./flow-leaves";
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

  it("keeps a finalizer after a return and code after a catch", () => {
    const finalized = flowOf(
      `function f() { try { return a(); } finally { b(); } c(); }\n${HELPERS}`
    );
    expect(kinds(finalized)).toEqual(["return", "call"]);
    const caught = flowOf(
      `function f() { try { return a(); } catch (e) { b(); } c(); }\n${HELPERS}`
    );
    expect(kinds(caught)).toEqual(["return", "call", "call"]);
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

describe("loops", () => {
  const source = [
    "function load() { return [1]; }",
    "async function f(xs: number[]) {",
    "  while (xs.length) { load(); }",
    "  for (;;) { break; }",
    "  for (const x of load()) { if (x) continue; a(); }",
    "  for (const k in xs) {}",
    "  do { a(); } while (xs.length);",
    "  for await (const x of xs) {}",
    "}",
    HELPERS,
  ].join("\n");

  it("records every loop kind with its header", () => {
    const flow = flowOf(source);
    expect(
      flow.steps.map((step) =>
        step.kind === "loop" ? [step.loopKind, step.header] : step.kind
      )
    ).toEqual([
      ["while", "while (xs.length)"],
      ["for", "for (;;)"],
      ["for-of", "for (const x of load())"],
      ["for-in", "for (const k in xs)"],
      ["do-while", "while (xs.length)"],
      ["for-of", "for await (const x of xs)"],
    ]);
  });

  it("keeps header calls on the loop and body calls in the body", () => {
    const flow = flowOf(source);
    const whileLoop = stepAt(flow, 0, "loop");
    expect(whileLoop.callSiteIds).toEqual([]);
    expect(kinds(whileLoop.body)).toEqual(["call"]);
    expect(whileLoop.body.id).toBe(
      `${whileLoop.id.replace(/:loop$/, "")}:sequence:loop`
    );
    const forOf = stepAt(flow, 2, "loop");
    expect(forOf.callSiteIds).toHaveLength(1);
    expect(kinds(forOf.body)).toEqual(["branch", "call"]);
  });

  it("targets the innermost loop from break and continue", () => {
    const flow = flowOf(source);
    const forever = stepAt(flow, 1, "loop");
    expect(stepAt(forever.body, 0, "break").targetId).toBe(forever.id);
    const forOf = stepAt(flow, 2, "loop");
    const branch = stepAt(forOf.body, 0, "branch");
    expect(stepAt(branch.consequent, 0, "continue").targetId).toBe(forOf.id);
  });
});

describe("labels", () => {
  const source = [
    "function f(xs: number[]) {",
    "  outer: for (const x of xs) {",
    "    switch (x) {",
    "      case 1: continue outer;",
    "      case 2: break outer;",
    "      case 3: break;",
    "      default: continue;",
    "    }",
    "  }",
    "  block: { break block; }",
    "}",
  ].join("\n");

  it("resolves labelled and unlabelled jumps through a switch in a loop", () => {
    const flow = flowOf(source);
    expect(kinds(flow)).toEqual(["loop", "step"]);
    const loop = stepAt(flow, 0, "loop");
    const node = stepAt(loop.body, 0, "switch");
    expect(
      node.cases.map((item) => [
        kinds(item.body),
        item.body.steps[0]?.kind === "continue" ||
        item.body.steps[0]?.kind === "break"
          ? item.body.steps[0].targetId
          : null,
        item.fallsThrough,
      ])
    ).toEqual([
      [["continue"], loop.id, false],
      [["break"], loop.id, false],
      [[], null, false],
      [["continue"], loop.id, false],
    ]);
    expect(stepAt(flow, 1, "step").statements).toBe(1);
  });
});

describe("textOf", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(textOf("a  \n\t b", 0, 7)).toBe("a b");
    const long = textOf("x".repeat(100), 0, 100);
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
    expect(textOf("x".repeat(60), 0, 60)).toBe("x".repeat(60));
  });
});
