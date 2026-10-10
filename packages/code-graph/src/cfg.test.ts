import { describe, expect, it } from "vitest";

import { cfgOf, toDot } from "./cfg";
import type { Cfg } from "./cfg";
import { cfgFailures } from "./cfg-checks";
import type { FlowStep, SequenceNode } from "./code-graph";
import {
  branch,
  breakOut,
  call,
  continueOut,
  FN,
  fnWith,
  loop,
  ret,
  step,
  switchNode,
} from "./flow-fixture";
import { emptyBodySpec } from "./flow-measure";

const LOOP = `${FN}@1:loop`;
const SWITCH = `${FN}@1:switch`;

/** A block id shortened to what follows `@`, or `entry` / `exit`. */
const short = (id: string): string =>
  id.split("@")[1] ?? id.slice(id.lastIndexOf(":") + 1);

/** Edges as `from -kind-> to`, ids shortened. */
const edgesOf = (cfg: Cfg) =>
  cfg.edges.map(
    (edge) => `${short(edge.from)} -${edge.kind}-> ${short(edge.to)}`
  );

/** The CFG of a body, checked against the semantic invariants. */
const checked = (steps: readonly FlowStep[]): Cfg => {
  const fn = fnWith(steps);
  const cfg = cfgOf(fn);
  expect(cfgFailures(fn, cfg)).toEqual([]);
  return cfg;
};

const seq = (offset: number, tag: string, steps: readonly FlowStep[]) =>
  ({
    id: `${FN}@${offset}:sequence:${tag}`,
    kind: "sequence",
    span: fnWith([]).span,
    steps,
  }) satisfies SequenceNode;

const throwAt = (offset: number): FlowStep => ({
  ...(ret(offset) as Extract<FlowStep, { kind: "return" }>),
  throws: true,
});

const tryNode = (
  offset: number,
  block: readonly FlowStep[],
  finalizer: readonly FlowStep[] | null = null
): FlowStep => ({
  id: `${FN}@${offset}:try`,
  kind: "try",
  span: fnWith([]).span,
  block: seq(offset, "try", block),
  handler: null,
  finalizer: finalizer === null ? null : seq(offset, "finally", finalizer),
});

describe("cfgOf", () => {
  it("runs a straight body from the entry to the exit", () => {
    const cfg = checked([step(1, 2), call(5, [])]);
    expect(cfg.blocks.map((block) => block.kind)).toEqual([
      "entry",
      "step",
      "call",
      "exit",
    ]);
    expect(edgesOf(cfg)).toEqual([
      "1:step -next-> 5:call",
      "entry -next-> 1:step",
      "5:call -next-> exit",
    ]);
  });

  it("leads a return and a throw into the exit alone", () => {
    expect(edgesOf(checked([step(1, 1), ret(3)]))).toEqual([
      "3:return -return-> exit",
      "1:step -next-> 3:return",
      "entry -next-> 1:step",
    ]);
    expect(edgesOf(checked([throwAt(1)]))).toEqual([
      "1:return -throw-> exit",
      "entry -next-> 1:return",
    ]);
  });

  it("gives an empty body one block with the id of its room", () => {
    const fn = fnWith([]);
    const cfg = cfgOf(fn);
    expect(cfgFailures(fn, cfg)).toEqual([]);
    expect(cfg.blocks[1]).toEqual({ id: emptyBodySpec(fn).id, kind: "empty" });
  });

  it("opens a branch into its lanes and rejoins at the merge", () => {
    expect(edgesOf(checked([branch(1, [step(2, 1)]), step(9, 1)]))).toEqual([
      "1:branch -true-> 2:step",
      "1:branch -false-> 1:sequence:else",
      "2:step -next-> 1:branch:merge",
      "1:sequence:else -next-> 1:branch:merge",
      "1:branch:merge -next-> 9:step",
      "entry -next-> 1:branch",
      "9:step -next-> exit",
    ]);
  });

  it("never merges a returning lane", () => {
    const cfg = checked([branch(1, [ret(2)], [ret(3)]), step(9, 1)]);
    expect(edgesOf(cfg)).not.toContain("2:return -next-> 1:branch:merge");
    expect(
      cfg.edges.filter((edge) => edge.to === `${FN}@1:branch:merge`)
    ).toEqual([]);
  });

  it("gives a switch case, default and fallthrough edges", () => {
    const cfg = checked([
      switchNode(1, [
        { labels: ['case "a"'], body: [step(10, 1)], fallsThrough: true },
        { labels: ['case "b"'], body: [step(20, 1)] },
      ]),
    ]);
    expect(edgesOf(cfg)).toEqual([
      "1:switch -case-> 10:step",
      "10:step -fallthrough-> 20:step",
      "1:switch -case-> 20:step",
      "20:step -next-> 1:switch:merge",
      "1:switch -default-> 1:switch:default",
      "1:switch:default -next-> 1:switch:merge",
      "entry -next-> 1:switch",
      "1:switch:merge -next-> exit",
    ]);
  });

  it("leads a break nested in a case to the switch's merge", () => {
    const cfg = checked([
      switchNode(1, [
        {
          labels: ["default"],
          body: [branch(10, [breakOut(11, SWITCH)]), ret(15)],
        },
      ]),
    ]);
    expect(edgesOf(cfg)).toContain("11:break -break-> 1:switch:merge");
    expect(edgesOf(cfg)).toContain("1:switch -default-> 10:branch");
  });

  it("rings a while loop: zero runs, repeat and exit", () => {
    expect(edgesOf(checked([loop(1, [step(2, 1)])]))).toEqual([
      "1:loop -true-> 2:step",
      "1:loop -false-> 1:loop:end",
      "2:step -next-> 1:loop:again",
      "1:loop:again -loop-back-> 1:loop",
      "1:loop:again -false-> 1:loop:end",
      "entry -next-> 1:loop",
      "1:loop:end -next-> exit",
    ]);
  });

  it("runs a do-while's body before any test", () => {
    const cfg = checked([loop(1, [continueOut(2, LOOP)], "do-while")]);
    expect(edgesOf(cfg)).toEqual([
      "2:continue -continue-> 1:loop:again",
      "1:loop -next-> 2:continue",
      "1:loop:again -loop-back-> 1:loop",
      "1:loop:again -false-> 1:loop:end",
      "entry -next-> 1:loop",
      "1:loop:end -next-> exit",
    ]);
  });

  it("leads a break to the loop's end and leaves its again unreached", () => {
    const cfg = checked([loop(1, [step(2, 1), breakOut(3, LOOP)])]);
    expect(edgesOf(cfg)).toContain("3:break -break-> 1:loop:end");
    expect(cfg.edges.some((edge) => edge.to === `${LOOP}:again`)).toBe(false);
  });

  it("keeps a try one block with its ways out", () => {
    const cfg = checked([
      loop(1, [tryNode(2, [branch(3, [breakOut(4, LOOP)]), ret(6)])]),
    ]);
    expect(edgesOf(cfg)).toEqual([
      "2:try -break-> 1:loop:end",
      "2:try -return-> exit",
      "1:loop -true-> 2:try",
      "1:loop -false-> 1:loop:end",
      "1:loop:again -loop-back-> 1:loop",
      "1:loop:again -false-> 1:loop:end",
      "entry -next-> 1:loop",
      "1:loop:end -next-> exit",
    ]);
    expect(cfg.blocks.map((block) => short(block.id))).not.toContain("4:break");
  });

  it("lets a finally that returns override the try's jump", () => {
    const cfg = checked([
      loop(1, [tryNode(2, [breakOut(3, LOOP)], [ret(5)]), step(7, 1)]),
    ]);
    const out = edgesOf(cfg).filter((edge) => edge.startsWith("2:try"));
    expect(out).toEqual(["2:try -return-> exit"]);
  });

  it("lets a nested finally that returns override the inner throw", () => {
    const cfg = checked([
      tryNode(1, [tryNode(2, [throwAt(3)], [ret(5)])]),
      step(9, 1),
    ]);
    const out = edgesOf(cfg).filter((edge) => edge.startsWith("1:try"));
    expect(out).toEqual(["1:try -return-> exit"]);
  });

  it("gives labels grouped on one body a case and a default edge", () => {
    const cfg = checked([
      switchNode(1, [{ labels: ['case "a"', "default"], body: [step(10, 1)] }]),
    ]);
    expect(edgesOf(cfg).slice(0, 2)).toEqual([
      "1:switch -case-> 10:step",
      "1:switch -default-> 10:step",
    ]);
  });

  it("is deterministic and renders as dot", () => {
    const body = [branch(1, [step(2, 1)], [ret(3)]), step(9, 1)];
    expect(cfgOf(fnWith(body))).toEqual(cfgOf(fnWith(body)));
    const dot = toDot(cfgOf(fnWith(body)));
    expect(dot.split("\n")[0]).toBe("digraph cfg {");
    expect(dot).toContain(
      `  "${FN}@1:branch" -> "${FN}@2:step" [label="true"];`
    );
  });
});

describe("cfgFailures", () => {
  const fn = fnWith([loop(1, [step(2, 1), breakOut(3, LOOP)]), ret(9)]);
  const cfg = cfgOf(fn);

  it("reports a return with a normal successor", () => {
    const broken: Cfg = {
      ...cfg,
      edges: [
        ...cfg.edges,
        { from: `${FN}@9:return`, to: cfg.exit, kind: "next" },
      ],
    };
    expect(cfgFailures(fn, broken)).toEqual([
      `${FN}@9:return does not return into the exit alone`,
    ]);
  });

  it("reports a reachable dead end", () => {
    const broken: Cfg = {
      ...cfg,
      edges: cfg.edges.filter((edge) => edge.from !== `${FN}@2:step`),
    };
    expect(cfgFailures(fn, broken)).toContain(`${FN}@2:step is a dead end`);
  });

  it("reports a break into a composite that does not enclose it", () => {
    const broken: Cfg = {
      ...cfg,
      edges: cfg.edges.map((edge) =>
        edge.kind === "break" ? { ...edge, to: `${LOOP}:again` } : edge
      ),
    };
    expect(cfgFailures(fn, broken)).toEqual([
      `${FN}@3:break does not break an enclosing composite`,
    ]);
  });
});
