import { FLOW_BUDGET } from "@repo/world-generator/config";
import { describe, expect, it } from "vitest";

import type { FlowStep, FunctionNode } from "./code-graph";
import {
  branch,
  call,
  calling,
  clusterOf,
  fnWith,
  loop,
  site,
  step,
  switchNode,
  valid,
} from "./flow-fixture";
import { layoutFlow, planFlow } from "./flow-layout";
import { indexSites } from "./flow-text";
import { FORK_QUOTA, measureTree } from "./flow-tree";

const nested = (depth: number, offset: number): FlowStep =>
  switchNode(offset, [
    {
      labels: ["case 1"],
      body:
        depth === 0 ? [step(offset + 1, 1)] : [nested(depth - 1, offset + 10)],
    },
  ]);

/** Rings nested `depth` deep, a step at the centre: each adds 3 m of width. */
const rings = (depth: number, offset: number): FlowStep =>
  loop(offset, [
    depth === 0 ? step(offset + 1, 1) : rings(depth - 1, offset + 10),
  ]);

describe("budget", () => {
  it("collapses the deepest forks first until the column fits the width budget", () => {
    const cluster = valid(clusterOf([nested(20, 1)]));
    expect(cluster.width).toBeLessThanOrEqual(FLOW_BUDGET.width);
    expect(cluster.rooms[0]?.role).toBe("switch");
    expect(cluster.rooms.some((room) => room.role === "collapsed")).toBe(true);
  });

  it("folds rooms inside a lane before touching the fork", () => {
    const rooms = Array.from({ length: 100 }, (_, index) =>
      calling(10 * index + 5, 1)
    );
    const cluster = valid(
      clusterOf(
        [
          branch(
            1,
            rooms.map((room) => room.node)
          ),
        ],
        rooms.flatMap((room) => room.sites)
      )
    );
    expect(cluster.rooms[0]?.role).toBe("fork");
    expect(cluster.rooms.length).toBeLessThanOrEqual(FLOW_BUDGET.rooms);
    expect(cluster.depth).toBeLessThanOrEqual(FLOW_BUDGET.depth);
  });

  it("opens at most a quarter of the room budget in forks, the first ones in source order", () => {
    const forks = Array.from({ length: FORK_QUOTA + 5 }, (_, index) =>
      branch(10 * index + 1, [step(10 * index + 2, 1)])
    );
    const tree = measureTree(fnWith(forks), indexSites([]));
    expect(tree.map((item) => item.kind)).toEqual([
      ...Array.from({ length: FORK_QUOTA }, () => "fork"),
      ...Array.from({ length: 5 }, () => "room"),
    ]);
    const cluster = clusterOf(forks);
    expect(cluster.rooms.length).toBeLessThanOrEqual(FLOW_BUDGET.rooms);
  });

  it("collapses the innermost rings first until nested loops fit the width budget", () => {
    const cluster = valid(clusterOf([rings(20, 1)]));
    expect(cluster.width).toBeLessThanOrEqual(FLOW_BUDGET.width);
    expect(cluster.rooms[0]?.role).toBe("loop-head");
    const collapsed = cluster.rooms.filter((room) => room.role === "collapsed");
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.label).toMatch(/^while \(x\) · /);
  });

  it("counts loops against the same quota as forks", () => {
    const steps = Array.from({ length: FORK_QUOTA + 2 }, (_, index) =>
      index % 2 === 0
        ? loop(10 * index + 1, [step(10 * index + 2, 1)])
        : branch(10 * index + 1, [step(10 * index + 2, 1)])
    );
    const tree = measureTree(fnWith(steps), indexSites([]));
    expect(tree.filter((item) => item.kind !== "room")).toHaveLength(
      FORK_QUOTA
    );
    expect(tree.slice(-2).map((item) => item.kind)).toEqual(["room", "room"]);
  });

  it("stops when nothing more can fold", () => {
    const { node, sites } = calling(1, 100);
    const cluster = clusterOf([node], sites);
    expect(cluster.rooms).toHaveLength(1);
    expect(cluster.depth).toBeGreaterThan(FLOW_BUDGET.depth);
  });

  it("plans three hundred nested switches quickly", () => {
    const fn: FunctionNode = fnWith([nested(300, 1)]);
    const started = Date.now();
    const cluster = layoutFlow(planFlow(fn, []));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(cluster.width).toBeLessThanOrEqual(FLOW_BUDGET.width);
  });

  it("plans three hundred nested loops quickly", () => {
    const started = Date.now();
    const cluster = layoutFlow(planFlow(fnWith([rings(300, 1)]), []));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(cluster.width).toBeLessThanOrEqual(FLOW_BUDGET.width);
  });
});

describe("port pitch", () => {
  it("spaces ports on one wall by the wider of the two callees", () => {
    const wide = calling(1, 1);
    const narrow = call(5, [site(5, "h").id]);
    const cluster = clusterOf(
      [wide.node, narrow],
      [...wide.sites, site(5, "h")],
      (unitId) => (unitId === "m.ts::g1" ? 10 : 4)
    );
    expect(
      cluster.ports.slice(1).map((port) => [port.wall, port.lo, port.hi])
    ).toEqual([
      ["east", 0, 10],
      ["west", 0, 10],
      ["east", 10, 22],
      ["west", 10, 22],
    ]);
  });

  it("keeps the portals below a port clear of a wide callee's door", () => {
    const { node, sites } = calling(1, 3);
    const along = (width: number) =>
      clusterOf([node], sites, () => width).portals.find(
        (portal) => portal.kind === "call"
      )?.along;
    // A plain column's door ends at the port; a 6 m callee's reaches 1 m on.
    expect(along(4)).toBe(6);
    expect(along(6)).toBe(9);
  });
});
