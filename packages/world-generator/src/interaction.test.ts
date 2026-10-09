import type { BuiltPortal, GeneratedWorld, Point } from "@repo/types";
import { describe, expect, it } from "vitest";

import { clusterWorld } from "./cluster-world";
import { openingCentre, placementInside } from "./geometry";
import {
  inAnyTrigger,
  nearestTarget,
  portalToEnter,
  PROMPT_DISTANCE,
} from "./interaction";
import { portalWorld } from "./portal-world";

const world = portalWorld();

const portalById = (id: string): BuiltPortal => {
  const found = world.built.portals.find((item) => item.portal.id === id);
  if (found === undefined) {
    throw new Error(`No portal ${id}`);
  }
  return found;
};

const centre = (rect: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

const scaled = (point: Point, factor: number): Point => ({
  x: point.x * factor,
  z: point.z * factor,
});

const sideways = (point: Point): Point => ({ x: -point.z, z: point.x });

describe("portalToEnter", () => {
  const portal = portalById("portal:login>shared");
  const intoWall = scaled(portal.normal, -1);
  const position = centre(portal.trigger);

  it("fires for a player in the trigger, facing the wall and walking into it", () => {
    expect(
      portalToEnter(
        world.built.portals,
        { position, forward: intoWall, velocity: scaled(intoWall, 2) },
        true
      )
    ).toBe(portal);
  });

  it("does not fire while strafing along the wall or looking away", () => {
    const strafing = {
      position,
      forward: intoWall,
      velocity: sideways(intoWall),
    };
    expect(portalToEnter(world.built.portals, strafing, true)).toBeNull();
    const away = {
      position,
      forward: portal.normal,
      velocity: scaled(intoWall, 2),
    };
    expect(portalToEnter(world.built.portals, away, true)).toBeNull();
    const standing = { position, forward: intoWall, velocity: { x: 0, z: 0 } };
    expect(portalToEnter(world.built.portals, standing, true)).toBeNull();
    // A smoothed velocity that has all but decayed is standing too.
    const drifting = {
      position,
      forward: intoWall,
      velocity: scaled(intoWall, 0.05),
    };
    expect(portalToEnter(world.built.portals, drifting, true)).toBeNull();
  });

  it("stays quiet until re-armed, and outside every trigger", () => {
    const motion = { position, forward: intoWall, velocity: intoWall };
    expect(portalToEnter(world.built.portals, motion, false)).toBeNull();
    expect(inAnyTrigger(world.built.portals, position)).toBe(true);
    const landing = portal.arrival.position;
    expect(inAnyTrigger(world.built.portals, landing)).toBe(false);
    expect(
      portalToEnter(
        world.built.portals,
        { position: landing, forward: intoWall, velocity: intoWall },
        true
      )
    ).toBeNull();
  });
});

describe("nearestTarget", () => {
  it("names the portal in front of the player, from its return point", () => {
    const portal = portalById("return:login");
    const { position } = portal.returnPoint;
    const forward = scaled(portal.normal, -1);
    expect(
      nearestTarget(world.built, "login", {
        position,
        forward,
        velocity: { x: 0, z: 0 },
      })
    ).toEqual({ kind: "portal", portalId: "return:login" });
    expect(
      nearestTarget(world.built, "login", {
        position,
        forward: portal.normal,
        velocity: { x: 0, z: 0 },
      })
    ).toBeNull();
  });

  /** The prompt from just inside main's door towards login, in `candidate`. */
  const promptAtLoginDoor = (candidate: GeneratedWorld) => {
    const main = candidate.built.rooms.find(({ room }) => room.id === "main");
    if (main === undefined) {
      throw new Error("No main room");
    }
    const index = main.room.doors.findIndex((door) => {
      const target = candidate.layout.rooms.find(
        (room) => room.id === door.targetRoomId
      );
      return (
        door.targetRoomId === "login" ||
        (target?.connection?.from === "main" &&
          target.connection.to === "login")
      );
    });
    const opening = main.openings[index];
    if (opening === undefined) {
      throw new Error("No door from main to login");
    }
    const inside = placementInside(main.room, opening.wall, opening.along);
    const door = openingCentre(main.room, opening);
    const forward = {
      x: door.x - inside.position.x,
      z: door.z - inside.position.z,
    };
    const length = Math.hypot(forward.x, forward.z);
    expect(length).toBeLessThanOrEqual(PROMPT_DISTANCE);
    return nearestTarget(candidate.built, "main", {
      position: inside.position,
      forward: scaled(forward, 1 / length),
      velocity: { x: 0, z: 0 },
    });
  };

  it("names the room beyond a door", () => {
    expect(promptAtLoginDoor(world)).toEqual({
      kind: "door",
      roomId: "main",
      targetRoomId: "login",
    });
  });

  it("carries a lane door's lane onto the target only walked with the flow", () => {
    const lane = { kind: "true" } as const;
    const laned = (forward: boolean): GeneratedWorld => ({
      ...world,
      built: {
        ...world.built,
        rooms: world.built.rooms.map((built) =>
          built.room.id === "main"
            ? {
                ...built,
                room: {
                  ...built.room,
                  doors: built.room.doors.map((door) =>
                    door.targetRoomId === "login"
                      ? { ...door, lane, ...(forward ? { forward } : {}) }
                      : door
                  ),
                },
                openings: built.openings.map((opening, index) =>
                  built.room.doors[index]?.targetRoomId === "login"
                    ? { ...opening, lane }
                    : opening
                ),
              }
            : built
        ),
      },
    });
    const target = { kind: "door", roomId: "main", targetRoomId: "login" };
    expect(promptAtLoginDoor(laned(true))).toEqual({ ...target, lane });
    expect(promptAtLoginDoor(laned(false))).toEqual(target);
  });

  it("names the room at the far end of a corridor", () => {
    const corridorWorld = [2, 3, 5, 4, 6, 7, 8]
      .map((seed) => portalWorld(seed))
      .find((candidate) =>
        candidate.layout.rooms.some(
          (data) =>
            data.kind === "corridor" &&
            data.connection?.from === "main" &&
            data.connection.to === "login"
        )
      );
    expect(corridorWorld).toBeDefined();
    const prompt =
      corridorWorld === undefined ? null : promptAtLoginDoor(corridorWorld);
    expect(prompt).toEqual({
      kind: "door",
      roomId: "main",
      targetRoomId: "login",
    });
  });

  it("names the unit beyond a corridor from a room of a cluster", () => {
    const corridorWorld = Array.from({ length: 30 }, (_, index) =>
      clusterWorld(index + 1)
    ).find((candidate) =>
      candidate.layout.rooms.some(
        (data) =>
          data.kind === "corridor" &&
          data.connection?.from === "fn" &&
          data.connection.to === "callee"
      )
    );
    expect(corridorWorld).toBeDefined();
    if (corridorWorld === undefined) {
      return;
    }
    const call = corridorWorld.built.rooms.find(
      ({ room }) => room.id === "call"
    );
    const index = call?.room.doors.findIndex((door) => {
      const target = corridorWorld.layout.rooms.find(
        (room) => room.id === door.targetRoomId
      );
      return target?.connection?.to === "callee";
    });
    const opening = index === undefined ? undefined : call?.openings[index];
    if (call === undefined || opening === undefined) {
      throw new Error("No corridor door from call to callee");
    }
    const inside = placementInside(call.room, opening.wall, opening.along);
    const door = openingCentre(call.room, opening);
    const forward = {
      x: door.x - inside.position.x,
      z: door.z - inside.position.z,
    };
    const length = Math.hypot(forward.x, forward.z);
    expect(
      nearestTarget(corridorWorld.built, "call", {
        position: inside.position,
        forward: scaled(forward, 1 / length),
        velocity: { x: 0, z: 0 },
      })
    ).toEqual({ kind: "door", roomId: "call", targetRoomId: "callee" });
  });

  it("knows nothing outside every room", () => {
    expect(
      nearestTarget(world.built, null, {
        position: { x: 0, z: 0 },
        forward: { x: 1, z: 0 },
        velocity: { x: 0, z: 0 },
      })
    ).toBeNull();
  });
});
