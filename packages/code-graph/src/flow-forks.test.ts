import type { RoomCluster } from "@repo/types";
import {
  FLOW_MAX_CASES,
  FLOW_TOP_MIN_DEPTH,
} from "@repo/world-generator/config";
import { describe, expect, it } from "vitest";

import type { FlowStep } from "./code-graph";
import {
  branch,
  calling,
  clusterOf,
  FN,
  loop,
  ret,
  site,
  step,
  switchNode,
  valid,
} from "./flow-fixture";
import { parseFlowNodeId } from "./ids";

const shape = (cluster: RoomCluster) =>
  cluster.rooms.map((room) => [
    room.role,
    room.rect.minX,
    room.rect.maxX,
    room.rect.minZ,
    room.rect.maxZ,
  ]);

const returnsOf = (cluster: RoomCluster) =>
  cluster.portals
    .filter((portal) => portal.kind === "return")
    .map((portal) => [portal.roomId, portal.along]);

describe("forks", () => {
  it("opens an if into a fork, two lanes with ports on their outer walls and a merge", () => {
    const yes = calling(3, 1);
    const no = calling(6, 1);
    const cluster = valid(
      clusterOf(
        [step(1, 1), branch(2, [yes.node], [no.node])],
        [...yes.sites, ...no.sites]
      )
    );
    expect(cluster.width).toBe(6);
    expect(shape(cluster)).toEqual([
      ["step", 0, 6, 0, 4],
      ["fork", 0, 6, 4, 6],
      ["call", 0, 3, 6, 9],
      ["call", 3, 6, 6, 9],
      ["merge", 0, 6, 9, 11],
    ]);
    expect(cluster.rooms.map((room) => room.label)).toEqual([
      "1 statement",
      "if (x)",
      "g1(…)",
      "g1(…)",
      "end if",
    ]);
    expect(cluster.rooms.map((room) => room.lane)).toEqual([
      undefined,
      undefined,
      { kind: "true" },
      { kind: "false" },
      undefined,
    ]);
    expect(cluster.doors).toEqual([
      { from: `${FN}@1:step`, to: `${FN}@2:branch`, opening: "passage" },
      { from: `${FN}@2:branch`, to: `${FN}@3:call`, lane: { kind: "true" } },
      { from: `${FN}@2:branch`, to: `${FN}@6:call`, lane: { kind: "false" } },
      { from: `${FN}@3:call`, to: `${FN}@2:branch:merge`, opening: "passage" },
      { from: `${FN}@6:call`, to: `${FN}@2:branch:merge`, opening: "passage" },
    ]);
    expect(
      cluster.ports.map((port) => [port.roomId, port.wall, port.lo, port.hi])
    ).toEqual([
      [`${FN}@1:step`, "north", 0, 6],
      [`${FN}@3:call`, "west", 6, 9],
      [`${FN}@6:call`, "east", 6, 9],
    ]);
    expect(returnsOf(cluster)).toEqual([[`${FN}@2:branch:merge`, 3]]);
    expect(parseFlowNodeId(`${FN}@2:branch:merge`)).toMatchObject({
      kind: "branch",
      tag: "merge",
    });
  });

  it("makes a fork the entry room when the body starts with an if", () => {
    const cluster = valid(clusterOf([branch(1, [step(2, 1)], [step(3, 1)])]));
    expect(cluster.entryRoomId).toBe(`${FN}@1:branch`);
    expect(cluster.rooms[0]?.rect).toEqual({
      minX: 0,
      maxX: 6,
      minZ: 0,
      maxZ: FLOW_TOP_MIN_DEPTH,
    });
  });

  it("hangs the condition's calls off the fork room itself", () => {
    const a = site(1, "g");
    const cluster = valid(
      clusterOf([step(0, 1), branch(1, [step(2, 1)], [], [a.id])], [a])
    );
    expect(
      cluster.ports
        .filter((port) => port.reservedFor !== undefined)
        .map((port) => [port.roomId, port.wall])
    ).toEqual([
      [`${FN}@1:branch`, "east"],
      [`${FN}@1:branch`, "west"],
    ]);
  });

  it("gives an empty lane one room and a return room its own portal", () => {
    const cluster = valid(
      clusterOf([step(1, 1), branch(2, [ret(3)]), step(4, 1)])
    );
    expect(shape(cluster)).toEqual([
      ["step", 0, 6, 0, 4],
      ["fork", 0, 6, 4, 6],
      ["return", 0, 3, 6, 8],
      ["lane", 3, 6, 6, 8],
      ["merge", 0, 6, 8, 10],
      ["step", 0, 6, 10, 12],
    ]);
    const lane = cluster.rooms[3];
    expect(lane).toMatchObject({
      id: `${FN}@2:sequence:else`,
      label: "false · empty",
      lane: { kind: "false" },
    });
    // The return room does not rejoin; the empty lane does.
    expect(
      cluster.doors.filter((door) => door.to === `${FN}@2:branch:merge`)
    ).toEqual([
      {
        from: `${FN}@2:sequence:else`,
        to: `${FN}@2:branch:merge`,
        opening: "passage",
      },
    ]);
    expect(returnsOf(cluster)).toEqual([
      [`${FN}@3:return`, 1.5],
      [`${FN}@4:step`, 3],
    ]);
  });

  it("ends the column without a merge when every lane returns", () => {
    const cluster = valid(
      clusterOf([step(1, 1), branch(2, [ret(3)], [step(4, 1), ret(5)])])
    );
    expect(shape(cluster)).toEqual([
      ["step", 0, 6, 0, 4],
      ["fork", 0, 6, 4, 6],
      ["return", 0, 3, 6, 10],
      ["step", 3, 6, 6, 8],
      ["return", 3, 6, 8, 10],
    ]);
    expect(cluster.depth).toBe(10);
    expect(returnsOf(cluster)).toEqual([
      [`${FN}@3:return`, 1.5],
      [`${FN}@5:return`, 4.5],
    ]);
  });

  it("nests an else-if as a fork inside the false lane, stretching the true lane beside it", () => {
    const cluster = valid(
      clusterOf([
        step(1, 1),
        branch(2, [step(3, 1)], [branch(4, [step(5, 1)], [step(6, 1)])]),
      ])
    );
    expect(cluster.width).toBe(9);
    expect(shape(cluster)).toEqual([
      ["step", 0, 9, 0, 4],
      ["fork", 0, 9, 4, 6],
      ["step", 0, 3, 6, 12],
      ["fork", 3, 9, 6, 8],
      ["step", 3, 6, 8, 10],
      ["step", 6, 9, 8, 10],
      ["merge", 3, 9, 10, 12],
      ["merge", 0, 9, 12, 14],
    ]);
    expect(cluster.rooms.map((room) => room.lane?.kind)).toEqual([
      undefined,
      undefined,
      "true",
      "false",
      "true",
      "false",
      "false",
      undefined,
    ]);
  });

  it("shares a column's slack between lanes on the grid, the remainder to the last", () => {
    const four = switchNode(1, [
      { labels: ["case 1"], body: [step(10, 1)] },
      { labels: ["case 2"], body: [step(11, 1)] },
      { labels: ["case 3"], body: [step(12, 1)] },
      { labels: ["default"], body: [step(13, 1)] },
    ]);
    const five = switchNode(20, [
      { labels: ["case 1"], body: [step(30, 1)] },
      { labels: ["case 2"], body: [step(31, 1)] },
      { labels: ["case 3"], body: [step(32, 1)] },
      { labels: ["case 4"], body: [step(33, 1)] },
      { labels: ["default"], body: [step(34, 1)] },
    ]);
    const cluster = valid(clusterOf([four, five]));
    expect(cluster.width).toBe(15);
    const lanes = cluster.rooms
      .filter((room) => room.lane !== undefined)
      .map((room) => room.rect.maxX - room.rect.minX);
    expect(lanes).toEqual([3.5, 3.5, 3.5, 4.5, 3, 3, 3, 3, 3]);
  });
});

const cases = (bodies: readonly (readonly FlowStep[])[]) =>
  bodies.map((body, index) => ({
    labels: [`case ${index + 1}`],
    body,
  }));

/** `depth` switches inside one another, each with one case, the innermost holding a step. */
describe("switches", () => {
  it("opens a switch into one lane per case plus a default that rejoins", () => {
    const middle = calling(10, 3);
    const cluster = valid(
      clusterOf(
        [
          switchNode(1, cases([[step(5, 1)], [middle.node], [ret(7)]])),
          step(8, 1),
        ],
        middle.sites
      )
    );
    expect(cluster.width).toBe(12);
    expect(cluster.rooms.map((room) => [room.role, room.label])).toEqual([
      ["switch", "switch (x)"],
      ["step", "1 statement"],
      ["call", "g1(…), g2(…), g3(…)"],
      ["return", "return"],
      ["lane", "default · empty"],
      ["merge", "end switch"],
      ["step", "1 statement"],
    ]);
    expect(cluster.rooms[4]?.id).toBe(`${FN}@1:switch:default`);
    expect(
      cluster.doors
        .filter((door) => door.from === `${FN}@1:switch`)
        .map((door) => door.lane)
    ).toEqual([
      { kind: "case", text: "case 1" },
      { kind: "case", text: "case 2" },
      { kind: "case", text: "case 3" },
      { kind: "default" },
    ]);
    // The middle lane touches no boundary: its calls are portals on its own walls.
    const middleRoom = cluster.rooms[2];
    expect(
      cluster.ports.filter((port) => port.roomId === middleRoom?.id)
    ).toEqual([]);
    const portals = cluster.portals.filter(
      (portal) => portal.roomId === middleRoom?.id
    );
    expect(portals.map((portal) => [portal.wall, portal.along])).toEqual([
      ["east", 5.5],
      ["west", 5.5],
      ["east", 7.5],
    ]);
    expect(middleRoom?.rect).toEqual({ minX: 3, maxX: 6, minZ: 4, maxZ: 9 });
    expect(returnsOf(cluster)).toEqual([
      [`${FN}@7:return`, 7.5],
      [`${FN}@8:step`, 6],
    ]);
  });

  it("merges case labels into one lane", () => {
    const cluster = valid(
      clusterOf([
        switchNode(1, [
          { labels: ['case "a"', 'case "b"'], body: [step(5, 1)] },
          { labels: ["default"], body: [step(6, 1)] },
        ]),
      ])
    );
    expect(
      cluster.doors.map((door) => [door.to.slice(FN.length + 1), door.lane])
    ).toEqual([
      ["5:step", { kind: "case", text: 'case "a", case "b"' }],
      ["6:step", { kind: "default" }],
      ["1:switch:merge", undefined],
      ["1:switch:merge", undefined],
    ]);
  });

  it("cuts a long list of merged case labels", () => {
    const labels = Array.from({ length: 30 }, (_, index) => `case ${index}`);
    const cluster = clusterOf([
      switchNode(1, [{ labels, body: [step(5, 1)] }]),
    ]);
    const text = cluster.doors[0]?.lane?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(60);
    expect(text.endsWith("…")).toBe(true);
  });

  it("keeps a switch collapsed when it has too many cases", () => {
    const many = switchNode(
      1,
      cases(
        Array.from({ length: FLOW_MAX_CASES + 1 }, (_, index) => [
          step(10 + index, 1),
        ])
      )
    );
    expect(clusterOf([many]).rooms.map((room) => room.role)).toEqual([
      "collapsed",
    ]);
  });
});

describe("return portals", () => {
  it("puts one on a collapsed room that ends the flow", () => {
    const cluster = valid(
      clusterOf([step(0, 1), loop(1, [ret(2)], "do-while")])
    );
    expect(cluster.rooms.map((room) => room.role)).toEqual([
      "step",
      "collapsed",
    ]);
    expect(returnsOf(cluster)).toEqual([[`${FN}@1:loop`, 2]]);
  });
});
