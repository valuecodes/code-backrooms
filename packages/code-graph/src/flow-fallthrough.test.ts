import type { RoomCluster } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  branch,
  calling,
  clusterOf,
  FN,
  ret,
  step,
  switchNode,
  valid,
} from "./flow-fixture";

const returnsOf = (cluster: RoomCluster) =>
  cluster.portals
    .filter((portal) => portal.kind === "return")
    .map((portal) => [portal.roomId, portal.along]);

/** The rect of the room with `id`, as `[minX, maxX, minZ, maxZ]`. */
const rectOf = (cluster: RoomCluster, id: string) => {
  const rect = cluster.rooms.find((room) => room.id === id)?.rect;
  return rect === undefined
    ? null
    : [rect.minX, rect.maxX, rect.minZ, rect.maxZ];
};

/** Portals on a room as `[wall, along]`. */
const portalsOn = (cluster: RoomCluster, id: string) =>
  cluster.portals
    .filter((portal) => portal.roomId === id)
    .map((portal) => [portal.wall, portal.along]);

describe("fallthrough", () => {
  it("opens a switch whose case falls through, a door into the next lane", () => {
    const cluster = valid(
      clusterOf([
        switchNode(1, [
          { labels: ["case 1"], body: [step(5, 1)], fallsThrough: true },
          { labels: ["case 2"], body: [ret(6)] },
          { labels: ["default"], body: [ret(7)] },
        ]),
      ])
    );
    expect(cluster.rooms.map((room) => room.role)).toEqual([
      "switch",
      "step",
      "return",
      "return",
    ]);
    expect(cluster.doors).toEqual([
      {
        from: `${FN}@1:switch`,
        to: `${FN}@5:step`,
        lane: { kind: "case", text: "case 1" },
      },
      {
        from: `${FN}@1:switch`,
        to: `${FN}@6:return`,
        lane: { kind: "case", text: "case 2" },
      },
      {
        from: `${FN}@5:step`,
        to: `${FN}@6:return`,
        lane: { kind: "case", text: "case 2" },
      },
      {
        from: `${FN}@1:switch`,
        to: `${FN}@7:return`,
        lane: { kind: "default" },
      },
    ]);
    // Every way ends: no merge room, a return portal on each return.
    expect(returnsOf(cluster).map(([id]) => id)).toEqual([
      `${FN}@6:return`,
      `${FN}@7:return`,
    ]);
  });

  it("deepens the next lane's first room to reach a long falling-through lane", () => {
    const cluster = valid(
      clusterOf([
        switchNode(1, [
          {
            labels: ["case 1"],
            body: [step(5, 1), step(6, 1), step(7, 1)],
            fallsThrough: true,
          },
          { labels: ["case 2"], body: [step(8, 1)] },
          { labels: ["default"], body: [step(9, 1)] },
        ]),
      ])
    );
    expect(rectOf(cluster, `${FN}@7:step`)).toEqual([0, 3, 8, 10]);
    // Starts at the fork's top, ends MIN_SHARED below the last room's top.
    expect(rectOf(cluster, `${FN}@8:step`)).toEqual([3, 6, 4, 10]);
    expect(cluster.doors).toContainEqual({
      from: `${FN}@7:step`,
      to: `${FN}@8:step`,
      lane: { kind: "case", text: "case 2" },
    });
    // Only the lanes that do not fall through run into the merge room.
    expect(
      cluster.doors
        .filter((door) => door.to === `${FN}@1:switch:merge`)
        .map((door) => door.from)
    ).toEqual([`${FN}@8:step`, `${FN}@9:step`]);
  });

  it("falls into a fork's head, deepened to share its west wall", () => {
    const cluster = valid(
      clusterOf([
        switchNode(1, [
          {
            labels: ["case 1"],
            body: [step(5, 1), step(6, 1)],
            fallsThrough: true,
          },
          {
            labels: ["case 2"],
            body: [branch(7, [step(8, 1)], [step(9, 1)])],
          },
          { labels: ["default"], body: [step(10, 1)] },
        ]),
      ])
    );
    expect(rectOf(cluster, `${FN}@7:branch`)).toEqual([3, 9, 4, 8]);
    expect(cluster.doors).toContainEqual({
      from: `${FN}@6:step`,
      to: `${FN}@7:branch`,
      lane: { kind: "case", text: "case 2" },
    });
  });

  it("keeps the walls with a fallthrough door free of call portals", () => {
    const first = calling(10, 3);
    const second = calling(20, 3);
    const cluster = valid(
      clusterOf(
        [
          switchNode(1, [
            { labels: ["case 1"], body: [first.node], fallsThrough: true },
            { labels: ["case 2"], body: [second.node] },
            { labels: ["default"], body: [step(30, 1)] },
          ]),
        ],
        [...first.sites, ...second.sites]
      )
    );
    // Case 1 falls through its east wall: a port and portals on the west.
    expect(
      cluster.ports
        .filter((port) => port.roomId === `${FN}@10:call`)
        .map((port) => port.wall)
    ).toEqual(["west"]);
    expect(portalsOn(cluster, `${FN}@10:call`).map(([wall]) => wall)).toEqual([
      "west",
      "west",
    ]);
    // Case 2 is fallen into through its west wall: every portal east.
    expect(portalsOn(cluster, `${FN}@20:call`).map(([wall]) => wall)).toEqual([
      "east",
      "east",
      "east",
    ]);
  });

  it("puts the calls of a lane with fallthrough doors on both sides on its south wall", () => {
    const middle = calling(10, 2);
    const cluster = valid(
      clusterOf(
        [
          switchNode(1, [
            { labels: ["case 1"], body: [step(5, 1)], fallsThrough: true },
            { labels: ["case 2"], body: [middle.node], fallsThrough: true },
            { labels: ["case 3"], body: [step(6, 1)] },
            { labels: ["default"], body: [step(7, 1)] },
          ]),
        ],
        middle.sites
      )
    );
    const rect = rectOf(cluster, `${FN}@10:call`);
    expect(rect?.slice(0, 2)).toEqual([3, 7.5]);
    expect(portalsOn(cluster, `${FN}@10:call`)).toEqual([
      ["south", 4.25],
      ["south", 6.25],
    ]);
    expect(
      cluster.doors.filter(
        (door) => door.from === `${FN}@10:call` || door.to === `${FN}@10:call`
      )
    ).toEqual([
      {
        from: `${FN}@1:switch`,
        to: `${FN}@10:call`,
        lane: { kind: "case", text: "case 2" },
      },
      {
        from: `${FN}@5:step`,
        to: `${FN}@10:call`,
        lane: { kind: "case", text: "case 2" },
      },
      {
        from: `${FN}@10:call`,
        to: `${FN}@6:step`,
        lane: { kind: "case", text: "case 3" },
      },
    ]);
  });
});
