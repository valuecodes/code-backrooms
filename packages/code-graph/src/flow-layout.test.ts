import {
  DOOR_WIDTH,
  FLOW_BUDGET,
  GRID,
  MIN_SHARED,
  PORTAL_GAP,
  WALL_THICKNESS,
} from "@repo/world-generator/config";
import { describe, expect, it } from "vitest";

import type {
  CallSite,
  FlowStep,
  FunctionNode,
  SequenceNode,
  SourceSpan,
} from "./code-graph";
import { layoutFlow } from "./flow-layout";
import { parseFlowNodeId } from "./ids";

const FN = "m.ts::f";

const span: SourceSpan = {
  start: 0,
  end: 10,
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 10,
};

const site = (offset: number, callee: string): CallSite => ({
  id: `${FN}@${offset}`,
  callerId: FN,
  calleeName: callee,
  calleeId: `m.ts::${callee}`,
  resolution: "resolved",
  kind: "call",
  awaited: false,
  span: { ...span, start: offset, end: offset + 3 },
});

const step = (offset: number, statements: number): FlowStep => ({
  id: `${FN}@${offset}:step`,
  kind: "step",
  span,
  statements,
});

const call = (offset: number, callSiteIds: readonly string[]): FlowStep => ({
  id: `${FN}@${offset}:call`,
  kind: "call",
  span,
  callSiteIds,
});

const ret = (
  offset: number,
  callSiteIds: readonly string[] = []
): FlowStep => ({
  id: `${FN}@${offset}:return`,
  kind: "return",
  span,
  throws: false,
  callSiteIds,
});

/** An await of something unresolved: no site lies in its span. */
const awaitNode = (offset: number): FlowStep => ({
  id: `${FN}@${offset}:await`,
  kind: "await",
  span: { ...span, start: 900, end: 910 },
  callSiteIds: [],
});

const sequence = (
  offset: number,
  steps: readonly FlowStep[]
): SequenceNode => ({
  id: `${FN}@${offset}:sequence:then`,
  kind: "sequence",
  span,
  steps,
});

const branch = (offset: number, steps: readonly FlowStep[]): FlowStep => ({
  id: `${FN}@${offset}:branch`,
  kind: "branch",
  span,
  condition: "x",
  callSiteIds: [],
  consequent: sequence(offset, steps),
  alternate: { ...sequence(offset, []), id: `${FN}@${offset}:sequence:else` },
});

const fnWith = (steps: readonly FlowStep[]): FunctionNode => ({
  id: FN,
  moduleId: "m.ts",
  name: "f",
  qualifiedName: "f",
  kind: "declaration",
  span,
  exported: false,
  async: false,
  isStatic: false,
  parentId: null,
  className: null,
  flow: { id: `${FN}@0:sequence:body`, kind: "sequence", span, steps },
});

/** A room calling `count` distinct functions g1..gN from one statement. */
const calling = (offset: number, count: number) => {
  const sites = Array.from({ length: count }, (_, index) =>
    site(offset + index, `g${index + 1}`)
  );
  return {
    node: call(
      offset,
      sites.map((item) => item.id)
    ),
    sites,
  };
};

const onGrid = (value: number): boolean =>
  Math.abs(value / GRID - Math.round(value / GRID)) < 1e-9;

describe("layoutFlow", () => {
  it("stacks one full-width room per step from z = 0, doors between neighbours", () => {
    const a = site(5, "g");
    const cluster = layoutFlow(
      fnWith([step(1, 2), call(5, [a.id]), awaitNode(9), ret(12)]),
      [a]
    );
    expect(cluster.width).toBe(4);
    expect(cluster.rooms.map((room) => room.role)).toEqual([
      "step",
      "call",
      "await",
      "return",
    ]);
    expect(cluster.rooms.map((room) => room.rect.minX)).toEqual([0, 0, 0, 0]);
    expect(cluster.rooms.map((room) => room.rect.maxX)).toEqual([4, 4, 4, 4]);
    expect(cluster.rooms.map((room) => room.rect.minZ)).toEqual([0, 4, 7, 9]);
    expect(cluster.rooms.map((room) => room.rect.maxZ)).toEqual([4, 7, 9, 11]);
    expect(cluster.depth).toBe(11);
    expect(cluster.entryRoomId).toBe(`${FN}@1:step`);
    expect(cluster.doors).toEqual([
      { from: `${FN}@1:step`, to: `${FN}@5:call` },
      { from: `${FN}@5:call`, to: `${FN}@9:await` },
      { from: `${FN}@9:await`, to: `${FN}@12:return` },
    ]);
    expect(cluster.rooms.map((room) => room.label)).toEqual([
      "2 statements",
      "g(…)",
      "await",
      "return",
    ]);
    for (const room of cluster.rooms) {
      for (const value of Object.values(room.rect)) {
        expect(onGrid(value)).toBe(true);
      }
      expect(room.rect.maxZ - room.rect.minZ).toBeGreaterThanOrEqual(
        MIN_SHARED
      );
    }
  });

  it("gives an empty body one room that still names its function", () => {
    const cluster = layoutFlow(fnWith([]), []);
    expect(cluster.rooms).toEqual([
      {
        id: `${FN}@0:step:empty`,
        rect: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
        role: "step",
        label: "empty body",
      },
    ]);
    expect(parseFlowNodeId(cluster.entryRoomId)).toMatchObject({
      functionId: FN,
      kind: "step",
      tag: "empty",
    });
    expect(cluster.ports).toEqual([
      { roomId: `${FN}@0:step:empty`, wall: "north", lo: 0, hi: 4 },
    ]);
  });

  it("hangs callees on the wall used least recently and keeps ports 6 m apart per wall", () => {
    const one = calling(5, 1);
    const two = calling(20, 2);
    const three = calling(40, 1);
    const cluster = layoutFlow(
      fnWith([step(1, 1), one.node, two.node, three.node]),
      [...one.sites, ...two.sites, ...three.sites]
    );
    // The second room's second callee lands on the east wall, where a port
    // just ended at z = 7: the room grows so its port can end at 13.
    expect(
      cluster.rooms.map((room) => [room.rect.minZ, room.rect.maxZ])
    ).toEqual([
      [0, 4],
      [4, 7],
      [7, 13],
      [13, 16],
    ]);
    expect(cluster.ports).toEqual([
      { roomId: `${FN}@1:step`, wall: "north", lo: 0, hi: 4 },
      {
        roomId: `${FN}@5:call`,
        wall: "east",
        lo: 4,
        hi: 7,
        reservedFor: "m.ts::g1",
        portalId: `portal:${FN}@5`,
      },
      {
        roomId: `${FN}@20:call`,
        wall: "west",
        lo: 7,
        hi: 10,
        reservedFor: "m.ts::g1",
        portalId: `portal:${FN}@20`,
      },
      {
        roomId: `${FN}@20:call`,
        wall: "east",
        lo: 7,
        hi: 13,
        reservedFor: "m.ts::g2",
        portalId: `portal:${FN}@21`,
      },
      {
        roomId: `${FN}@40:call`,
        wall: "west",
        lo: 13,
        hi: 16,
        reservedFor: "m.ts::g1",
        portalId: `portal:${FN}@40`,
      },
    ]);
    expect(cluster.portals.filter((portal) => portal.kind === "call")).toEqual(
      []
    );
  });

  it("alternates walls for a run of single-call rooms without growing them", () => {
    const rooms = Array.from({ length: 6 }, (_, index) =>
      calling(10 * index + 5, 1)
    );
    const cluster = layoutFlow(
      fnWith([step(1, 1), ...rooms.map((room) => room.node)]),
      rooms.flatMap((room) => room.sites)
    );
    expect(
      cluster.ports.slice(1).map((port) => [port.wall, port.lo, port.hi])
    ).toEqual([
      ["east", 4, 7],
      ["west", 7, 10],
      ["east", 10, 13],
      ["west", 13, 16],
      ["east", 16, 19],
      ["west", 19, 22],
    ]);
  });

  it("pre-places portals for the third callee onwards, clear of the port and the corners", () => {
    for (const [count, depth] of [
      [3, 6.5],
      [4, 6.5],
      [5, 8.5],
    ] as const) {
      const { node, sites } = calling(5, count);
      const cluster = layoutFlow(fnWith([step(1, 1), node]), sites);
      const room = cluster.rooms[1];
      expect(room?.rect.maxZ, `${count} callees`).toBe(4 + depth);
      const ports = cluster.ports.filter((port) => port.roomId === room?.id);
      const extras = cluster.portals.filter((portal) => portal.kind === "call");
      expect(ports.map((port) => [port.wall, port.lo, port.hi])).toEqual([
        ["east", 4, 7],
        ["west", 4, 7],
      ]);
      expect(extras).toHaveLength(count - 2);
      expect(extras.map((portal) => portal.target)).toEqual(
        sites.slice(2).map((item) => item.calleeId)
      );
      for (const portal of extras) {
        const along = portal.along ?? 0;
        const port = ports.find((item) => item.wall === portal.wall);
        expect(along - DOOR_WIDTH / 2).toBeGreaterThanOrEqual(
          (port?.hi ?? 0) + DOOR_WIDTH / 2 + PORTAL_GAP
        );
        expect(
          (room?.rect.maxZ ?? 0) - along - DOOR_WIDTH / 2
        ).toBeGreaterThanOrEqual(WALL_THICKNESS + PORTAL_GAP);
        expect(onGrid(along * 2)).toBe(true);
      }
      const sameWall = extras
        .filter((portal) => portal.wall === "east")
        .map((portal) => portal.along ?? 0);
      const pitches = sameWall
        .slice(1)
        .map((along, index) => along - (sameWall[index] ?? 0));
      expect(pitches.every((pitch) => pitch >= DOOR_WIDTH + PORTAL_GAP)).toBe(
        true
      );
    }
  });

  it("puts one return portal on the last room's south wall, whatever ends the body", () => {
    for (const last of [ret(9), step(9, 1)]) {
      const cluster = layoutFlow(fnWith([step(1, 1), last]), []);
      expect(cluster.portals).toEqual([
        {
          id: `return:${last.id}`,
          kind: "return",
          roomId: last.id,
          wall: "south",
          along: 2,
          label: "return",
        },
      ]);
    }
  });

  it("sizes rooms by role, statements, callees and the entry minimum", () => {
    const depths = (
      steps: readonly FlowStep[],
      sites: readonly CallSite[] = []
    ) =>
      layoutFlow(fnWith(steps), sites).rooms.map(
        (room) => room.rect.maxZ - room.rect.minZ
      );
    expect(depths([step(1, 1), step(5, 1), step(9, 9), step(13, 100)])).toEqual(
      [4, 2, 6, 8]
    );
    const a = site(5, "g");
    expect(depths([step(1, 1), awaitNode(5), ret(9)])).toEqual([4, 2, 2]);
    expect(depths([step(1, 1), ret(5, [a.id])], [a])).toEqual([4, 3]);
    expect(depths([branch(1, [step(2, 1)])])).toEqual([4]);
    expect(depths([step(1, 1), branch(5, [step(6, 1)])])).toEqual([4, 3]);
  });

  it("collapses a composite into one room carrying every call inside it", () => {
    const inner = calling(7, 2);
    const cluster = layoutFlow(
      fnWith([step(1, 1), branch(5, [step(6, 1), inner.node])]),
      inner.sites
    );
    expect(cluster.rooms[1]).toMatchObject({
      id: `${FN}@5:branch`,
      role: "collapsed",
      label: "if (x) · 2 statements · 2 calls",
    });
    expect(
      cluster.ports
        .filter((port) => port.reservedFor !== undefined)
        .map((port) => port.reservedFor)
    ).toEqual(["m.ts::g1", "m.ts::g2"]);
  });

  it("reaches every callee by a port or a portal, within budget, for a huge body", () => {
    const rooms = Array.from({ length: 100 }, (_, index) =>
      calling(10 * index + 1, 1)
    );
    const sites = rooms.flatMap((room) => room.sites);
    const cluster = layoutFlow(fnWith(rooms.map((room) => room.node)), sites);
    expect(cluster.rooms.length).toBeLessThanOrEqual(FLOW_BUDGET.rooms);
    expect(cluster.depth).toBeLessThanOrEqual(FLOW_BUDGET.depth);
    const reached = new Set([
      ...cluster.ports.flatMap((port) =>
        port.reservedFor === undefined ? [] : [port.reservedFor]
      ),
      ...cluster.portals.flatMap((portal) =>
        portal.target === undefined ? [] : [portal.target]
      ),
    ]);
    expect(reached).toEqual(new Set(["m.ts::g1"]));
    const folded = cluster.rooms.filter((room) => room.role === "collapsed");
    expect(folded.length).toBeGreaterThan(0);
    expect(folded[0]?.label).toMatch(/^\d+ statements · \d+ calls$/);
    const gaps = cluster.rooms
      .slice(1)
      .map(
        (room, index) => room.rect.minZ - (cluster.rooms[index]?.rect.maxZ ?? 0)
      );
    expect(gaps.every((gap) => gap === 0)).toBe(true);
  });

  it("is the same on every call", () => {
    const { node, sites } = calling(5, 4);
    const fn = fnWith([step(1, 3), node, ret(20)]);
    expect(layoutFlow(fn, sites)).toEqual(layoutFlow(fn, sites));
  });
});
