import type { BuiltWorld, GeneratedWorld } from "@repo/types";
import { openingCentre, roomBounds } from "@repo/world-generator/geometry";
import { describe, expect, it } from "vitest";

import type { ExampleName } from "./examples";
import { EMPTY_VISITS, mapModel, visit, visitedIn } from "./map-model";
import { codeGraphOf, worldFromCode } from "./world-from-code";

/** An example's world, or fails the test with the parser's message. */
const worldOf = (name: ExampleName, seed = 1): GeneratedWorld => {
  const { codeGraph, error } = codeGraphOf(name);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return worldFromCode(codeGraph, seed);
};

const builtOf = (name: ExampleName, seed = 1): BuiltWorld =>
  worldOf(name, seed).built;

const demo = builtOf("demo");

/** The hub of `demo.ts`, with doors to its functions. */
const hubRoom = () => {
  const found = demo.rooms.find(({ room }) => room.id === "demo.ts");
  if (found === undefined) {
    throw new Error("no demo.ts hub");
  }
  return found;
};

describe("visit", () => {
  it("records a room of the world", () => {
    const visits = visit(EMPTY_VISITS, demo, "a");
    expect([...visitedIn(visits, demo)]).toEqual(["a"]);
  });

  it("leaves the visits alone between rooms and on a repeat", () => {
    const visits = visit(EMPTY_VISITS, demo, "a");
    expect(visit(visits, demo, null)).toBe(visits);
    expect(visit(visits, demo, "a")).toBe(visits);
  });

  it("starts over for another world", () => {
    const other = builtOf("demo", 2);
    const visits = visit(visit(EMPTY_VISITS, demo, "a"), demo, "b");
    const next = visit(visits, other, "c");
    expect([...visitedIn(next, other)]).toEqual(["c"]);
    expect(visitedIn(next, demo).size).toBe(0);
    expect(visitedIn(visit(visits, other, null), other).size).toBe(0);
  });

  it("shows nothing of a world the visits do not belong to", () => {
    const visits = visit(EMPTY_VISITS, demo, "a");
    expect(visitedIn(visits, builtOf("demo", 2)).size).toBe(0);
  });
});

describe("mapModel", () => {
  it("is empty before any room is visited", () => {
    expect(mapModel(demo, new Set(), null)).toEqual({
      rooms: [],
      doors: [],
      portals: [],
    });
  });

  it("shows the room stood in and, hollow, the rooms behind its doors", () => {
    const { room } = hubRoom();
    const model = mapModel(demo, new Set([room.id]), room.id);
    const neighbours = new Set(room.doors.map((door) => door.targetRoomId));
    expect(neighbours.size).toBeGreaterThan(0);
    expect(model.rooms.map((shown) => shown.id).toSorted()).toEqual(
      [room.id, ...neighbours].toSorted()
    );
    for (const shown of model.rooms) {
      const own = shown.id === room.id;
      expect(shown.visited).toBe(own);
      expect(shown.current).toBe(own);
    }
    expect(model.rooms.find((shown) => shown.id === room.id)?.rect).toEqual(
      roomBounds(room)
    );
  });

  it("puts the doors at the centres of the openings, each once", () => {
    const start = hubRoom();
    const { room } = start;
    const alone = mapModel(demo, new Set([room.id]), room.id);
    expect(alone.doors.map((door) => door.point)).toEqual(
      start.openings.map((opening) => openingCentre(room, opening))
    );
    // Both sides of a door report the same opening.
    const beyond = room.doors[0]?.targetRoomId ?? "";
    const both = mapModel(demo, new Set([room.id, beyond]), room.id);
    const keys = both.doors.map(({ point }) => `${point.x},${point.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    const across = demo.rooms.find((built) => built.room.id === beyond);
    expect(both.doors.length).toBeLessThan(
      start.openings.length + (across?.openings.length ?? 0)
    );
  });

  it("shows the portals of visited rooms at their frames", () => {
    const world = builtOf("portals");
    const portal = world.portals[0];
    expect(portal).toBeDefined();
    if (portal === undefined) {
      return;
    }
    const from = portal.portal.from;
    const model = mapModel(world, new Set([from]), from);
    const ids = world.portals
      .filter((built) => built.portal.from === from)
      .map((built) => built.portal.id);
    expect(model.portals.map((shown) => shown.id)).toEqual(ids);
    expect(model.portals[0]).toEqual({
      id: portal.portal.id,
      kind: portal.portal.kind,
      point: { x: portal.frame.center[0], z: portal.frame.center[2] },
      normal: portal.normal,
    });
    expect(mapModel(world, new Set(), null).portals).toEqual([]);
  });
});
