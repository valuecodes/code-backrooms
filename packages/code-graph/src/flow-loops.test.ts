import type { RoomCluster } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  branch,
  calling,
  clusterOf,
  continueOut,
  FN,
  fnWith,
  loop,
  ret,
  site,
  step,
  valid,
} from "./flow-fixture";
import { planFlow } from "./flow-layout";
import { parseFlowNodeId } from "./ids";

const shape = (cluster: RoomCluster) =>
  cluster.rooms.map((room) => [
    room.role,
    room.rect.minX,
    room.rect.maxX,
    room.rect.minZ,
    room.rect.maxZ,
  ]);

/** Doors as `from -> to` with the lane kind, ids shortened to what follows `@`. */
const doorsOf = (cluster: RoomCluster) =>
  cluster.doors.map((door) => [
    door.from.split("@")[1],
    door.to.split("@")[1],
    door.lane?.kind ?? null,
  ]);

const LOOP = `${FN}@1:loop`;

/** The rooms that hold a port for a callee. */
const owners = (cluster: RoomCluster) =>
  cluster.ports
    .filter((port) => port.reservedFor !== undefined)
    .map((port) => port.roomId);

describe("loops", () => {
  it("lays a while out as a ring: head, body beside the back corridor, test, end", () => {
    const body = calling(2, 1);
    const cluster = valid(clusterOf([loop(1, [body.node])], body.sites));
    expect(cluster.width).toBe(6);
    expect(shape(cluster)).toEqual([
      ["loop-head", 0, 6, 0, 4],
      ["call", 0, 3, 4, 7],
      ["loop-back", 3, 6, 4, 7],
      ["loop-test", 0, 6, 7, 9],
      ["loop-end", 0, 6, 9, 11],
    ]);
    expect(cluster.rooms.map((room) => room.label)).toEqual([
      "while (x)",
      "g1(…)",
      "repeat",
      "again?",
      "end while",
    ]);
    expect(cluster.rooms.map((room) => room.lane)).toEqual([
      undefined,
      { kind: "loop", text: "body" },
      { kind: "back", text: "repeat" },
      undefined,
      undefined,
    ]);
    expect(doorsOf(cluster)).toEqual([
      ["1:loop", "2:call", "loop"],
      ["2:call", "1:loop:again", null],
      ["1:loop:again", "1:loop:back", "back"],
      ["1:loop:back", "1:loop", null],
      ["1:loop:again", "1:loop:end", "exit"],
    ]);
    // The body's call is on the cluster's west wall only; the end returns.
    expect(
      cluster.ports
        .filter((port) => port.reservedFor !== undefined)
        .map((port) => [port.roomId, port.wall])
    ).toEqual([[`${FN}@2:call`, "west"]]);
    expect(
      cluster.portals.map((portal) => [portal.kind, portal.roomId])
    ).toEqual([["return", `${LOOP}:end`]]);
  });

  it("tags the ring's own rooms on the loop's id and labels them in the plan", () => {
    const cluster = clusterOf([step(0, 1), loop(1, [step(2, 1)], "for-of")]);
    const ids = cluster.rooms.map((room) => room.id).slice(1);
    expect(ids.filter((id) => parseFlowNodeId(id) === null)).toEqual([]);
    expect(ids.filter((id) => id.startsWith(LOOP))).toEqual([
      LOOP,
      `${LOOP}:back`,
      `${LOOP}:again`,
      `${LOOP}:end`,
    ]);
    const { labels } = planFlow(
      fnWith([step(0, 1), loop(1, [step(2, 1)], "for-of")]),
      []
    );
    expect(
      [LOOP, `${LOOP}:again`, `${LOOP}:back`, `${LOOP}:end`].map((id) =>
        labels.get(id)
      )
    ).toEqual(["for (x)", "again?", "repeat", "end for"]);
  });

  it("hangs a header's calls off the head, a do-while's off the test room", () => {
    const header = site(1, "g");
    const whileCluster = valid(
      clusterOf([loop(1, [step(2, 1)], "while", [header.id])], [header])
    );
    const doCluster = valid(
      clusterOf([loop(1, [step(2, 1)], "do-while", [header.id])], [header])
    );
    expect(new Set(owners(whileCluster))).toEqual(new Set([LOOP]));
    expect(new Set(owners(doCluster))).toEqual(new Set([`${LOOP}:again`]));
    expect(doCluster.rooms.map((room) => room.label)).toEqual([
      "do",
      "1 statement",
      "repeat",
      "while (x)",
      "end while",
    ]);
  });

  it("gives an empty body one lane room", () => {
    const cluster = valid(clusterOf([step(0, 1), loop(1, [])]));
    expect(cluster.rooms[2]).toMatchObject({
      id: `${FN}@1:sequence:loop`,
      role: "lane",
      label: "body · empty",
    });
  });

  it("keeps a loop collapsed when its body only ever returns", () => {
    for (const last of [ret(3), branch(3, [ret(4)], [ret(5)])]) {
      const cluster = valid(
        clusterOf([step(0, 1), loop(1, [step(2, 1), last])])
      );
      expect(cluster.rooms.map((room) => room.role)).toEqual([
        "step",
        "collapsed",
      ]);
    }
  });

  it("opens a body with a nested jump, the jump's only door the one in", () => {
    const cluster = valid(
      clusterOf([
        step(0, 1),
        loop(1, [branch(2, [continueOut(3, LOOP)]), step(4, 1)]),
      ])
    );
    expect(cluster.width).toBe(9);
    const roles = cluster.rooms.map((room) => room.role);
    expect(roles).toEqual([
      "step",
      "loop-head",
      "fork",
      "jump",
      "lane",
      "merge",
      "step",
      "loop-back",
      "loop-test",
      "loop-end",
    ]);
    const jump = `${FN}@3:continue`;
    expect(
      cluster.doors.filter((door) => door.from === jump || door.to === jump)
    ).toEqual([{ from: `${FN}@2:branch`, to: jump, lane: { kind: "true" } }]);
  });

  it("nests rings, a ring in a fork lane and a fork in a ring", () => {
    const nested = valid(
      clusterOf([step(0, 1), loop(1, [loop(2, [step(3, 1)])])])
    );
    expect(nested.width).toBe(9);
    const backs = nested.rooms
      .filter((room) => room.role === "loop-back")
      .map((room) => [room.rect.minX, room.rect.maxX]);
    expect(backs).toEqual([
      [3, 6],
      [6, 9],
    ]);
    const inLane = valid(
      clusterOf([step(0, 1), branch(1, [loop(2, [step(3, 1)])], [step(4, 1)])])
    );
    expect(inLane.width).toBe(9);
    expect(
      inLane.rooms.find((room) => room.role === "loop-head")?.lane
    ).toEqual({ kind: "true" });
    const forkInBody = valid(
      clusterOf([step(0, 1), loop(1, [branch(2, [step(3, 1)], [step(4, 1)])])])
    );
    expect(forkInBody.width).toBe(9);
  });

  it("puts the ring first in a function with the head as the entry room", () => {
    const cluster = valid(clusterOf([loop(1, [step(2, 1)]), step(3, 1)]));
    expect(cluster.entryRoomId).toBe(LOOP);
    expect(cluster.rooms[0]?.rect).toEqual({
      minX: 0,
      maxX: 6,
      minZ: 0,
      maxZ: 4,
    });
  });
});
