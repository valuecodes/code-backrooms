import type { BuiltPortal, Point } from "@repo/types";
import { describe, expect, it } from "vitest";

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

  it("names the room beyond a door, through a corridor if there is one", () => {
    const main = world.built.rooms.find(({ room }) => room.id === "main");
    expect(main).toBeDefined();
    if (main === undefined) {
      return;
    }
    const index = main.room.doors.findIndex((door) => {
      const target = world.layout.rooms.find(
        (room) => room.id === door.targetRoomId
      );
      return (
        door.targetRoomId === "login" ||
        (target?.connection?.from === "main" &&
          target.connection.to === "login")
      );
    });
    const opening = main.openings[index];
    expect(opening).toBeDefined();
    if (opening === undefined) {
      return;
    }
    const inside = placementInside(main.room, opening.wall, opening.along);
    const door = openingCentre(main.room, opening);
    const forward = {
      x: door.x - inside.position.x,
      z: door.z - inside.position.z,
    };
    const length = Math.hypot(forward.x, forward.z);
    expect(length).toBeLessThanOrEqual(PROMPT_DISTANCE);
    expect(
      nearestTarget(world.built, "main", {
        position: inside.position,
        forward: scaled(forward, 1 / length),
        velocity: { x: 0, z: 0 },
      })
    ).toEqual({ kind: "door", roomId: "main", targetRoomId: "login" });
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
