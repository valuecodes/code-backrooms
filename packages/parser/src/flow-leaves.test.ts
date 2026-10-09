import type { SequenceNode } from "@repo/code-graph";
import { describe, expect, it } from "vitest";

import { textOf } from "./flow-leaves";
import { parseModule } from "./parser";

const flowOf = (source: string, name = "f"): SequenceNode => {
  const fn = parseModule({ path: "t.ts", source }).functions.find(
    (candidate) => candidate.qualifiedName === name
  );
  if (fn === undefined) {
    throw new Error(`no function ${name}`);
  }
  return fn.flow;
};

const kinds = (sequence: SequenceNode): readonly string[] =>
  sequence.steps.map((step) => step.kind);

describe("pathological nesting", () => {
  it("handles hundreds of nested terminal switches in linear time", () => {
    const depth = 300;
    const source = `function f(a: number) {${"switch (a) { default: ".repeat(depth)}return 1;${"}".repeat(depth)}}`;
    const started = Date.now();
    const flow = flowOf(source);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(kinds(flow)).toEqual(["switch"]);
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
