import type { PortalData, RoomData, WallSegment, WorldData } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  ARRIVAL_INSET,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  PORTAL_TRIGGER_DEPTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from "./config";
import { buildWorld, doorOpening, wallSegments } from "./geometry";

const lobby: RoomData = {
  id: "lobby",
  kind: "room",
  position: [0, 0, 0],
  width: 10,
  depth: 8,
  doors: [{ wall: "east", targetRoomId: "annex" }],
};

const annex: RoomData = {
  id: "annex",
  kind: "room",
  position: [9, 0, 1],
  width: 8,
  depth: 6,
  doors: [{ wall: "west", targetRoomId: "lobby" }],
};

/** Two rooms sharing the edge x = 5, overlapping on z in [-2, 4]. */
const worldData: WorldData = { startRoomId: "lobby", rooms: [lobby, annex] };

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

  it("keeps two doors on one wall as two separate gaps", () => {
    const wide: RoomData = { ...lobby, depth: 12 };
    const twoDoors = wallSegments(wide, [
      { wall: "east", along: -3, width: DOOR_WIDTH },
      { wall: "east", along: 3, width: DOOR_WIDTH },
    ]);
    const east2 = eastWallSegments(twoDoors, 5);
    expect(east2.filter((segment) => segment.kind === "wall")).toHaveLength(3);
    expect(east2.filter((segment) => segment.kind === "lintel")).toHaveLength(
      2
    );
  });

  it("rejects overlapping openings on one wall", () => {
    expect(() =>
      wallSegments(lobby, [
        { wall: "east", along: 1, width: DOOR_WIDTH },
        { wall: "east", along: 1.5, width: DOOR_WIDTH },
      ])
    ).toThrow(/overlapping door openings/);
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

  it("emits one doorway per connected pair, centred on the shared edge", () => {
    expect(world.doorways).toEqual([
      {
        center: [5, 0, 1],
        axis: "z",
        width: DOOR_WIDTH,
        depth: 2 * WALL_THICKNESS,
      },
    ]);
  });

  it("starts the player in the middle of the start room, facing its door", () => {
    expect(world.start).toEqual({ x: 0, z: 0 });
    expect(world.facing).toEqual({ x: 5, z: 1 });
  });

  it("faces +X when the start room has no door", () => {
    const alone: WorldData = {
      startRoomId: "lobby",
      rooms: [{ ...lobby, doors: [] }],
    };
    expect(buildWorld(alone).facing).toEqual({ x: 1, z: 0 });
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

describe("buildWorld portals", () => {
  const call: PortalData = {
    id: "portal:call",
    kind: "call",
    from: "lobby",
    to: "annex",
    wall: "north",
    along: 0,
  };
  const back: PortalData = {
    id: "return:annex",
    kind: "return",
    from: "annex",
    to: "lobby",
    wall: "east",
    along: 1,
  };
  const world = buildWorld({
    startRoomId: "lobby",
    rooms: [
      { ...lobby, portals: [call] },
      { ...annex, portals: [back] },
    ],
  });
  const [callBuilt, backBuilt] = world.portals;

  it("puts the frame on the wall's inner face with a trigger strip in front", () => {
    expect(callBuilt?.frame).toEqual({
      center: [0, 0, -4 + WALL_THICKNESS / 2],
      axis: "x",
      width: DOOR_WIDTH,
      depth: WALL_THICKNESS,
    });
    expect(callBuilt?.normal).toEqual({ x: 0, z: 1 });
    expect(callBuilt?.trigger).toEqual({
      minX: -DOOR_WIDTH / 2,
      maxX: DOOR_WIDTH / 2,
      minZ: -4 + WALL_THICKNESS,
      maxZ: -4 + WALL_THICKNESS + PORTAL_TRIGGER_DEPTH,
    });
    expect(callBuilt?.returnPoint).toEqual({
      position: { x: 0, z: -4 + ARRIVAL_INSET },
      facing: { x: 0, z: -4 + ARRIVAL_INSET + 1 },
    });
  });

  it("lands a call just inside the callee's return portal, and a return at the hub entry", () => {
    // The annex's east wall is at x = 13; its return portal is at z = 1.
    expect(callBuilt?.arrival).toEqual({
      position: { x: 13 - ARRIVAL_INSET, z: 1 },
      facing: { x: 13 - ARRIVAL_INSET - 1, z: 1 },
    });
    // The lobby has no return portal: its entry is the centre facing its door.
    expect(backBuilt?.arrival).toEqual({
      position: { x: 0, z: 0 },
      facing: { x: 5, z: 1 },
    });
  });

  it("lands recursion inside the room's own return portal", () => {
    const self: PortalData = { ...call, id: "portal:self", to: "lobby" };
    const exit: PortalData = { ...back, id: "return:lobby", from: "lobby" };
    const recursive = buildWorld({
      startRoomId: "lobby",
      rooms: [{ ...lobby, portals: [exit, self] }, annex],
    });
    expect(recursive.portals[1]?.arrival).toEqual(
      recursive.portals[0]?.returnPoint
    );
    // A start room with a return portal starts the player inside it.
    expect(recursive.start).toEqual(recursive.portals[0]?.returnPoint.position);
  });

  it("leaves the wall behind a portal solid", () => {
    const plain = buildWorld(worldData);
    expect(world.colliders).toHaveLength(plain.colliders.length);
    const north = world.rooms[0]?.segments.filter(
      (segment) =>
        Math.abs(segment.center[2] - (-4 + WALL_THICKNESS / 2)) < 1e-9
    );
    expect(north).toHaveLength(1);
    expect(world.doorways).toHaveLength(1);
  });

  it("rejects a portal to an unknown room", () => {
    expect(() =>
      buildWorld({
        startRoomId: "lobby",
        rooms: [{ ...lobby, portals: [{ ...call, to: "nowhere" }] }, annex],
      })
    ).toThrow(/unknown room "nowhere"/);
  });
});
