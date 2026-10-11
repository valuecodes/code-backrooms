import type { BuiltWorld, GeneratedWorld } from "@repo/types";
import { openingCentre, roomBounds } from "@repo/world-generator/geometry";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { BundledName } from "./examples";
import { EMPTY_VISITS, mapModel, visit, visitedIn } from "./map-model";
import { areasFromCode, codeGraphOf, worldFromCode } from "./world-from-code";

/** An example's world, or fails the test with the parser's message. */
const worldOf = (name: BundledName, seed = 1): GeneratedWorld => {
  const { codeGraph, error } = codeGraphOf(examples[name]);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return worldFromCode(codeGraph, seed);
};

const builtOf = (name: BundledName, seed = 1): BuiltWorld =>
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
    const visits = visit(EMPTY_VISITS, 1, "a");
    expect([...visitedIn(visits, 1)]).toEqual(["a"]);
  });

  it("leaves the visits alone between rooms and on a repeat", () => {
    const visits = visit(EMPTY_VISITS, 1, "a");
    expect(visit(visits, 1, null)).toBe(visits);
    expect(visit(visits, 1, "a")).toBe(visits);
  });

  it("starts over for another seed", () => {
    const visits = visit(visit(EMPTY_VISITS, 1, "a"), 1, "b");
    const next = visit(visits, 2, "c");
    expect([...visitedIn(next, 2)]).toEqual(["c"]);
    expect(visitedIn(next, 1).size).toBe(0);
    expect(visitedIn(visit(visits, 2, null), 2).size).toBe(0);
  });

  it("shows nothing of a world the visits do not belong to", () => {
    const visits = visit(EMPTY_VISITS, 1, "a");
    expect(visitedIn(visits, 2).size).toBe(0);
  });

  it("keeps the rooms while the world of the same seed grows", () => {
    // A new world object for the same seed, as a world that grew is.
    const before = builtOf("demo");
    const visits = visit(EMPTY_VISITS, 1, "demo.ts");
    const after = builtOf("demo");
    expect(after).not.toBe(before);
    expect([...visitedIn(visit(visits, 1, null), 1)]).toEqual(["demo.ts"]);
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

  it("draws one area of a world of several: only its rooms", () => {
    const { codeGraph } = codeGraphOf(examples.repo);
    if (codeGraph === null) {
      throw new Error("repo does not parse");
    }
    const { areas } = areasFromCode(codeGraph, 1);
    const server = areas.find((area) => area.id === "src/server.ts");
    if (server === undefined) {
      throw new Error("no src/server.ts area");
    }
    const everywhere = new Set(
      areas.flatMap((area) => area.graph.rooms.map((room) => room.id))
    );
    const own = new Set(server.built.rooms.map(({ room }) => room.id));
    const model = mapModel(server.built, everywhere, "src/server.ts");
    expect(model.rooms.length).toBeGreaterThan(0);
    expect(model.rooms.every((room) => own.has(room.id))).toBe(true);
    expect(
      model.portals.every(({ id }) =>
        server.built.portals.some(({ portal }) => portal.id === id)
      )
    ).toBe(true);
  });
});
