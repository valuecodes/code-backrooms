import type { FlowNode, SequenceNode } from "@repo/code-graph";
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

  it("ends at a do-while whose body returns, unless a jump restarts or leaves it", () => {
    expect(
      kinds(
        flowOf("function f(c: boolean) { do { return 1; } while (c); a(); }")
      )
    ).toEqual(["loop"]);
    expect(
      kinds(
        flowOf(
          `function f(c: boolean) { do { if (c) continue; return 1; } while (c); a(); }\n${HELPERS}`
        )
      )
    ).toEqual(["loop", "call"]);
    expect(
      kinds(
        flowOf(
          `function f(c: boolean) { while (c) { return 1; } a(); }\n${HELPERS}`
        )
      )
    ).toEqual(["loop", "call"]);
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
