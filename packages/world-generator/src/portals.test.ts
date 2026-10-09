import type { Portal, RoomData } from "@repo/types";
import { describe, expect, it } from "vitest";

import { DOOR_WIDTH, PORTAL_GAP, WALL_THICKNESS } from "./config";
import { generateLayout } from "./layout";
import { checkLayout } from "./layout-checks";
import { portalGraph } from "./portal-world";
import { placePortals } from "./portals";

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

const portal = (id: string, from = "lobby"): Portal => ({
  id,
  kind: "call",
  from,
  to: "annex",
});

describe("placePortals", () => {
  it("spreads portals over the walls, clear of the door and the corners", () => {
    const { rooms, unplaced } = placePortals(
      [lobby, annex],
      [portal("p1"), portal("p2"), portal("p3")]
    );
    expect(unplaced).toEqual([]);
    const placed = rooms[0]?.portals ?? [];
    expect(placed.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
    // The longest free wall wins each time, so three portals use three walls.
    expect(new Set(placed.map((item) => item.wall)).size).toBe(3);
    for (const item of placed) {
      expect((item.along * 4) % 1).toBe(0);
      const [lo, hi] =
        item.wall === "north" || item.wall === "south" ? [-5, 5] : [-4, 4];
      expect(item.along - DOOR_WIDTH / 2 - lo).toBeGreaterThanOrEqual(
        WALL_THICKNESS + PORTAL_GAP
      );
      expect(hi - item.along - DOOR_WIDTH / 2).toBeGreaterThanOrEqual(
        WALL_THICKNESS + PORTAL_GAP
      );
      // The door is centred at z = 1 on the east wall.
      const clearOfDoor =
        item.wall !== "east" ||
        Math.abs(item.along - 1) >= DOOR_WIDTH + PORTAL_GAP;
      expect(clearOfDoor, `${item.wall} ${item.along}`).toBe(true);
    }
    expect(rooms[1]?.portals).toBeUndefined();
  });

  it("is deterministic", () => {
    const requests = [portal("a"), portal("b"), portal("c"), portal("d")];
    expect(placePortals([lobby, annex], requests)).toEqual(
      placePortals([lobby, annex], requests)
    );
  });

  it("keeps a portal that already has a wall and position, and works around it", () => {
    const fixed = { ...portal("fixed"), wall: "north" as const, along: 0 };
    const { rooms } = placePortals([lobby, annex], [fixed, portal("free")]);
    const placed = rooms[0]?.portals ?? [];
    expect(placed[0]).toEqual({ ...fixed });
    const free = placed[1];
    expect(free).toBeDefined();
    const clearOfFixed =
      free !== undefined &&
      (free.wall !== "north" ||
        Math.abs(free.along) >= DOOR_WIDTH + PORTAL_GAP);
    expect(clearOfFixed).toBe(true);
  });

  it("reports portals that fit nowhere instead of dropping them", () => {
    const tiny: RoomData = {
      id: "tiny",
      kind: "room",
      position: [0, 0, 0],
      width: 5,
      depth: 5,
      doors: [],
    };
    const requests = Array.from({ length: 8 }, (_, index) =>
      portal(`p${index}`, "tiny")
    );
    const { rooms, unplaced } = placePortals([tiny], requests);
    // One portal per 5 m wall once the corners and the gaps are taken out.
    expect(rooms[0]?.portals).toHaveLength(4);
    expect(unplaced.map((item) => item.id)).toEqual(["p4", "p5", "p6", "p7"]);
  });

  it("never puts a portal on a corridor", () => {
    const corridor: RoomData = {
      id: "corridor-1",
      kind: "corridor",
      position: [0, 0, 0],
      width: 2,
      depth: 6,
      doors: [],
    };
    const { unplaced } = placePortals([corridor], [portal("p", "corridor-1")]);
    expect(unplaced).toHaveLength(1);
  });

  it("fits every portal of a laid-out graph for many seeds", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const layout = generateLayout(portalGraph, seed);
      expect(layout.unplacedPortals, `seed ${seed}`).toEqual([]);
      expect(layout.unresolved, `seed ${seed}`).toEqual([]);
      expect(checkLayout(portalGraph, layout), `seed ${seed}`).toEqual([]);
    }
  });
});
