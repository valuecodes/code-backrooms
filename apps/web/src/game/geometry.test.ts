import { describe, expect, it } from "vitest";

import { DOOR_HEIGHT, DOOR_WIDTH, WALL_HEIGHT, WALL_THICKNESS } from "./config";
import { buildWorld, doorOpening, wallSegments } from "./geometry";
import type { RoomData, WallSegment, WorldData } from "./types";
import { worldData } from "./world-data";

const lobby: RoomData = {
  id: "lobby",
  position: [0, 0, 0],
  width: 10,
  depth: 8,
  doors: [{ wall: "east", targetRoomId: "annex" }],
};

const annex: RoomData = {
  id: "annex",
  position: [9, 0, 1],
  width: 8,
  depth: 6,
  doors: [{ wall: "west", targetRoomId: "lobby" }],
};

const eastWallSegments = (segments: readonly WallSegment[], edgeX: number) =>
  segments.filter(
    (segment) =>
      Math.abs(segment.center[0] - (edgeX - WALL_THICKNESS / 2)) < 1e-9
  );

const westWallSegments = (segments: readonly WallSegment[], edgeX: number) =>
  segments.filter(
    (segment) =>
      Math.abs(segment.center[0] - (edgeX + WALL_THICKNESS / 2)) < 1e-9
  );

describe("doorOpening", () => {
  it("centres the door on the overlap of the shared edge, for both rooms", () => {
    const fromLobby = doorOpening(
      lobby,
      { wall: "east", targetRoomId: "annex" },
      annex
    );
    const fromAnnex = doorOpening(
      annex,
      { wall: "west", targetRoomId: "lobby" },
      lobby
    );
    expect(fromLobby.along).toBe(1);
    expect(fromAnnex.along).toBe(1);
    expect(fromLobby.width).toBe(DOOR_WIDTH);
  });

  it("rejects rooms whose edges do not touch", () => {
    const apart: RoomData = { ...annex, position: [9.5, 0, 1] };
    expect(() =>
      doorOpening(lobby, { wall: "east", targetRoomId: "annex" }, apart)
    ).toThrow(/do not share/);
  });

  it("rejects an overlap narrower than the door", () => {
    const grazing: RoomData = { ...annex, position: [9, 0, 7.5] };
    expect(() =>
      doorOpening(lobby, { wall: "east", targetRoomId: "annex" }, grazing)
    ).toThrow(/less than/);
  });
});

describe("wallSegments", () => {
  const opening = doorOpening(
    lobby,
    { wall: "east", targetRoomId: "annex" },
    annex
  );
  const segments = wallSegments(lobby, [opening]);
  const east = eastWallSegments(segments, 5);

  it("leaves a door-sized gap between two floor-level segments", () => {
    const walls = east
      .filter((segment) => segment.kind === "wall")
      .sort((p, q) => p.center[2] - q.center[2]);
    expect(walls).toHaveLength(2);
    const [south, north] = [walls.at(-1), walls.at(0)];
    expect(north).toBeDefined();
    expect(south).toBeDefined();
    if (north === undefined || south === undefined) {
      return;
    }
    const gapStart = north.center[2] + north.size[2] / 2;
    const gapEnd = south.center[2] - south.size[2] / 2;
    expect(gapStart).toBeCloseTo(1 - DOOR_WIDTH / 2);
    expect(gapEnd).toBeCloseTo(1 + DOOR_WIDTH / 2);
    expect(north.size[1]).toBe(WALL_HEIGHT);
  });

  it("puts a lintel over the opening", () => {
    const lintels = east.filter((segment) => segment.kind === "lintel");
    expect(lintels).toHaveLength(1);
    const [lintel] = lintels;
    expect(lintel?.size[0]).toBe(WALL_THICKNESS);
    expect(lintel?.size[1]).toBeCloseTo(WALL_HEIGHT - DOOR_HEIGHT);
    expect(lintel?.size[2]).toBeCloseTo(DOOR_WIDTH);
    expect(lintel?.center[1]).toBeCloseTo((DOOR_HEIGHT + WALL_HEIGHT) / 2);
    expect(lintel?.center[2]).toBeCloseTo(1);
  });

  it("builds solid walls on the other three sides", () => {
    const other = segments.filter((segment) => !east.includes(segment));
    expect(other).toHaveLength(3);
    expect(other.every((segment) => segment.kind === "wall")).toBe(true);
  });
});

describe("buildWorld", () => {
  const world = buildWorld(worldData);

  it("aligns the gaps on both sides of the shared wall", () => {
    const [lobbyBuilt, annexBuilt] = world.rooms;
    expect(lobbyBuilt).toBeDefined();
    expect(annexBuilt).toBeDefined();
    const lobbyGap = eastWallSegments(lobbyBuilt?.segments ?? [], 5)
      .filter((segment) => segment.kind === "lintel")
      .map((segment) => segment.center[2]);
    const annexGap = westWallSegments(annexBuilt?.segments ?? [], 5)
      .filter((segment) => segment.kind === "lintel")
      .map((segment) => segment.center[2]);
    expect(lobbyGap).toEqual(annexGap);
  });

  it("excludes lintels from the colliders", () => {
    const floorLevel = world.rooms.flatMap((built) =>
      built.segments.filter((segment) => segment.kind === "wall")
    );
    expect(world.colliders).toHaveLength(floorLevel.length);
  });

  it("starts the player in the middle of the start room", () => {
    expect(world.start).toEqual({ x: 0, z: 0 });
  });

  it("rejects a door with no door back", () => {
    const oneWay: WorldData = {
      startRoomId: "lobby",
      rooms: [lobby, { ...annex, doors: [] }],
    };
    expect(() => buildWorld(oneWay)).toThrow(/no west door back/);
  });

  it("rejects a door to an unknown room", () => {
    const dangling: WorldData = { startRoomId: "lobby", rooms: [lobby] };
    expect(() => buildWorld(dangling)).toThrow(/unknown room/);
  });
});
