import type { RoomCluster } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  branch,
  breakOut,
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
import { planFlow } from "./flow-layout";

const LOOP = `${FN}@1:loop`;
const SWITCH = `${FN}@1:switch`;

/** Portals as `kind room -> target`, ids shortened to what follows `@`. */
const portalsOf = (cluster: RoomCluster) =>
  cluster.portals.map((portal) => [
    portal.kind,
    portal.roomId.split("@")[1],
    portal.target?.split("@")[1] ?? null,
  ]);

const rolesOf = (cluster: RoomCluster) =>
  cluster.rooms.map((room) => room.role);

/** Doors into or out of a room. */
const doorsAt = (cluster: RoomCluster, id: string) =>
  cluster.doors.filter((door) => door.from === id || door.to === id);

describe("jump portals", () => {
  it("puts a continue's portal on its south wall, into the loop's test room", () => {
    const cluster = valid(
      clusterOf([
        step(0, 1),
        loop(1, [branch(2, [continueOut(3, LOOP)]), step(4, 1)]),
      ])
    );
    const jump = cluster.rooms.find((room) => room.role === "jump");
    expect(jump?.id).toBe(`${FN}@3:continue`);
    expect(cluster.portals.find((portal) => portal.kind === "jump")).toEqual({
      id: `jump:${FN}@3:continue`,
      kind: "jump",
      roomId: `${FN}@3:continue`,
      wall: "south",
      along: jump === undefined ? null : (jump.rect.minX + jump.rect.maxX) / 2,
      target: `${LOOP}:again`,
      label: "continue",
    });
  });

  it("opens a loop whose body ends in a break, the break the way to its end", () => {
    const cluster = valid(
      clusterOf([step(0, 1), loop(1, [step(2, 1), breakOut(3, LOOP)])])
    );
    expect(rolesOf(cluster)).toEqual([
      "step",
      "loop-head",
      "step",
      "jump",
      "loop-back",
      "loop-test",
      "loop-end",
    ]);
    // Nothing runs out of the body into the test room.
    expect(doorsAt(cluster, `${LOOP}:again`).map((door) => door.from)).toEqual([
      `${LOOP}:again`,
      `${LOOP}:again`,
    ]);
    expect(portalsOf(cluster)).toEqual([
      ["return", "1:loop:end", null],
      ["jump", "3:break", "1:loop:end"],
    ]);
  });

  it("opens a do-while whose body ends in a continue", () => {
    const cluster = valid(
      clusterOf([
        step(0, 1),
        loop(1, [step(2, 1), continueOut(3, LOOP)], "do-while"),
      ])
    );
    expect(rolesOf(cluster)).toContain("loop-test");
    expect(portalsOf(cluster)).toContainEqual([
      "jump",
      "3:continue",
      "1:loop:again",
    ]);
  });

  it("opens a switch with a nested break, its merge reached through the jump alone", () => {
    const cluster = valid(
      clusterOf([
        switchNode(1, [
          {
            labels: ["case 1"],
            body: [branch(10, [breakOut(11, SWITCH)]), ret(12)],
          },
          { labels: ["default"], body: [ret(13)] },
        ]),
        step(20, 1),
      ])
    );
    expect(rolesOf(cluster)).toEqual([
      "switch",
      "fork",
      "jump",
      "lane",
      "merge",
      "return",
      "return",
      "merge",
      "step",
    ]);
    const merge = `${SWITCH}:merge`;
    // No lane runs into the merge room: only the break's portal leads there.
    expect(doorsAt(cluster, merge).map((door) => door.from)).toEqual([merge]);
    expect(portalsOf(cluster)).toContainEqual([
      "jump",
      "11:break",
      "1:switch:merge",
    ]);
  });

  it("gives a collapsed room that ends by jumping out a jump portal, not a return", () => {
    const collapsed = switchNode(2, [
      { labels: ["case 1"], body: [step(10, 1)], fallsThrough: true },
      { labels: ["default"], body: [breakOut(11, LOOP)] },
    ]);
    const cluster = valid(clusterOf([step(0, 1), loop(1, [collapsed])]));
    expect(rolesOf(cluster)).toEqual([
      "step",
      "loop-head",
      "collapsed",
      "loop-back",
      "loop-test",
      "loop-end",
    ]);
    expect(portalsOf(cluster)).toEqual([
      ["return", "1:loop:end", null],
      ["jump", "2:switch", "1:loop:end"],
    ]);
  });

  it("collapses a loop again when its only jump out was swallowed", () => {
    // The break sits in a collapsed switch that runs on, so it has no portal
    // and nothing would lead to the test or end room.
    const swallowing = switchNode(2, [
      {
        labels: ["case 1"],
        body: [branch(10, [breakOut(11, LOOP)])],
        fallsThrough: true,
      },
      { labels: ["case 2"], body: [step(12, 1)] },
    ]);
    const steps = [step(0, 1), loop(1, [swallowing, ret(20)]), step(30, 1)];
    const cluster = valid(clusterOf(steps));
    expect(rolesOf(cluster)).toEqual(["step", "collapsed", "step"]);
    expect(cluster.portals.filter((portal) => portal.kind === "jump")).toEqual(
      []
    );
    expect(planFlow(fnWith(steps), []).jumps.size).toBe(0);
  });

  it("collapses a loop that a collapsed room leaves in more than one way", () => {
    // A falling-through case keeps the switch collapsed; it ends by leaving
    // the loop through a break and a continue, or a break and a return,
    // and one portal cannot show both.
    for (const other of [continueOut(12, LOOP), ret(12)]) {
      const mixed = switchNode(2, [
        { labels: ["case 1"], body: [step(10, 1)], fallsThrough: true },
        { labels: ["case 2"], body: [breakOut(11, LOOP)] },
        { labels: ["default"], body: [other] },
      ]);
      const cluster = valid(
        clusterOf([step(0, 1), loop(1, [mixed]), step(30, 1)])
      );
      expect(rolesOf(cluster)).toEqual(["step", "collapsed", "step"]);
      expect(
        cluster.portals.filter((portal) => portal.kind === "jump")
      ).toEqual([]);
    }
  });

  it("keeps the jump's target in the plan for the HUD", () => {
    const { jumps } = planFlow(
      fnWith([step(0, 1), loop(1, [branch(2, [breakOut(3, LOOP)])])]),
      []
    );
    expect([...jumps]).toEqual([[`${FN}@3:break`, `${LOOP}:end`]]);
  });
});
