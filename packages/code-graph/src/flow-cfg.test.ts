import type { RoomCluster } from "@repo/types";
import { FLOW_MAX_CASES } from "@repo/world-generator/config";
import { describe, expect, it } from "vitest";

import { cfgOf } from "./cfg";
import { cfgLayoutFailures } from "./cfg-checks";
import type { FlowStep, SequenceNode } from "./code-graph";
import {
  branch,
  breakOut,
  call,
  clusterOf,
  continueOut,
  FN,
  fnWith,
  loop,
  ret,
  step,
  switchNode,
  valid,
} from "./flow-fixture";

const LOOP = `${FN}@1:loop`;
const SWITCH = `${FN}@1:switch`;

/** Cases that pad a switch past FLOW_MAX_CASES so it stays one collapsed room. */
const padding = (offset: number, body: (at: number) => FlowStep) =>
  Array.from({ length: FLOW_MAX_CASES }, (_, index) => ({
    labels: [`case ${offset + index}`],
    body: [body(offset + index)],
  }));

/** Switches nested `depth` deep: too wide, so the deepest collapse. */
const nested = (depth: number, offset: number): FlowStep =>
  switchNode(offset, [
    {
      labels: ["case 1"],
      body:
        depth === 0 ? [step(offset + 1, 1)] : [nested(depth - 1, offset + 10)],
    },
  ]);

/** Rings nested `depth` deep: too wide, so the innermost collapse. */
const rings = (depth: number, offset: number): FlowStep =>
  loop(offset, [
    depth === 0 ? step(offset + 1, 1) : rings(depth - 1, offset + 10),
  ]);

/** A switch whose cases each run five deep steps into the next: folded. */
const fallingChain = (count: number): FlowStep =>
  switchNode(
    1,
    Array.from({ length: count }, (_, index) => ({
      labels: [`case ${index}`],
      body: [0, 1, 2, 3, 4].map((at) => step(100 + 10 * index + at, 8)),
      fallsThrough: index < count - 1,
    }))
  );

const seq = (offset: number, tag: string, steps: readonly FlowStep[]) =>
  ({
    id: `${FN}@${offset}:sequence:${tag}`,
    kind: "sequence",
    span: fnWith([]).span,
    steps,
  }) satisfies SequenceNode;

const tryNode = (offset: number, block: readonly FlowStep[]): FlowStep => ({
  id: `${FN}@${offset}:try`,
  kind: "try",
  span: fnWith([]).span,
  block: seq(offset, "try", block),
  handler: seq(offset, "catch", [step(offset + 50, 1)]),
  finalizer: null,
});

const bodies: Record<string, readonly FlowStep[]> = {
  "plain steps": [step(1, 1), call(3, []), step(5, 4)],
  "nested branches": [
    branch(1, [branch(2, [step(3, 1)], [ret(4)])], [step(6, 1)]),
    step(9, 1),
  ],
  "a branch whose lanes both return": [branch(1, [ret(2)], [ret(3)])],
  "a switch falling through, with a nested break": [
    switchNode(1, [
      { labels: ['case "a"'], body: [step(10, 1)], fallsThrough: true },
      {
        labels: ['case "b"'],
        body: [branch(20, [breakOut(21, SWITCH)]), step(25, 1)],
      },
      { labels: ["default"], body: [ret(30)] },
    ]),
    step(40, 1),
  ],
  "a while with a break and a continue": [
    loop(1, [
      branch(2, [continueOut(3, LOOP)]),
      branch(5, [breakOut(6, LOOP)]),
      step(8, 1),
    ]),
    ret(20),
  ],
  "a loop whose body ends in a break": [
    loop(1, [step(2, 1), breakOut(3, LOOP)]),
  ],
  "a do-while whose body ends in a continue": [
    loop(1, [step(2, 1), continueOut(3, LOOP)], "do-while"),
  ],
  "a chain folded to the depth budget": [fallingChain(6)],
  "switches collapsed to the width budget": [nested(20, 1)],
  "rings collapsed to the width budget": [rings(20, 1)],
  "a collapsed room that ends by jumping out": [
    step(0, 1),
    loop(1, [
      switchNode(2, [
        { labels: ["case 1"], body: [step(10, 1)], fallsThrough: true },
        { labels: ["default"], body: [breakOut(11, LOOP)] },
        ...padding(40, (at) => breakOut(at, LOOP)),
      ]),
    ]),
  ],
  "a collapsed room that returns early and runs on": [
    switchNode(
      1,
      padding(10, (at) => (at === 10 ? ret(at) : step(at, 1)))
    ),
    step(90, 1),
  ],
  "a try with a return inside": [tryNode(1, [branch(2, [ret(3)])]), step(9, 1)],
  "an empty body": [],
};

const failuresOf = (steps: readonly FlowStep[], cluster?: RoomCluster) => {
  const fn = fnWith(steps);
  return cfgLayoutFailures(fn, cfgOf(fn), cluster ?? valid(clusterOf(steps)));
};

describe("layout and CFG", () => {
  it.each(Object.entries(bodies))("walks the flow graph of %s", (_, steps) => {
    expect(failuresOf(steps)).toEqual([]);
  });

  it("reports a missing door", () => {
    const steps = bodies["nested branches"] ?? [];
    const cluster = clusterOf(steps);
    const [dropped, ...doors] = cluster.doors;
    expect(failuresOf(steps, { ...cluster, doors })).toEqual([
      `true edge ${dropped?.from} -> ${dropped?.to} cannot be walked`,
    ]);
  });

  it("reports a door no flow edge stands for", () => {
    const steps = [step(1, 1), step(3, 1), step(5, 1)];
    const cluster = clusterOf(steps);
    const from = `${FN}@1:step`;
    const to = `${FN}@5:step`;
    expect(
      failuresOf(steps, { ...cluster, doors: [...cluster.doors, { from, to }] })
    ).toEqual([`door ${from} -> ${to} has no flow edge`]);
  });

  it("reports a collapsed room that ends with no way out", () => {
    const steps = [
      step(0, 1),
      switchNode(1, [
        ...padding(10, (at) => ret(at)),
        { labels: ["default"], body: [ret(30)] },
      ]),
    ];
    const cluster = clusterOf(steps);
    expect(cluster.rooms[1]?.role).toBe("collapsed");
    const portals = cluster.portals.filter(
      (portal) => portal.roomId !== SWITCH
    );
    expect(portals).toHaveLength(cluster.portals.length - 1);
    // Every return inside the room now leads nowhere.
    const failures = failuresOf(steps, { ...cluster, portals });
    expect(failures).toHaveLength(FLOW_MAX_CASES + 1);
    expect(failures).toContain(
      `return edge ${FN}@10:return -> ${FN}:exit cannot be walked`
    );
  });
});
