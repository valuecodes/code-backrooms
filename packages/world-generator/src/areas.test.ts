import type { Rect } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  AREA_GAP,
  layoutBounds,
  mergeAreas,
  packOffsets,
  SHELF_WIDTH,
  translateLayout,
} from "./areas";
import { rectGap } from "./fit";
import { roomBounds, wallAxis } from "./geometry";
import { checkLayout } from "./layout-checks";
import { containsPoint } from "./locate";
import { areaWorld, portalWorld } from "./portal-world";
import { generateWorld } from "./world-generator";

const moved = (rect: Rect, x: number, z: number): Rect => ({
  minX: rect.minX + x,
  maxX: rect.maxX + x,
  minZ: rect.minZ + z,
  maxZ: rect.maxZ + z,
});

const rect = (width: number, depth: number): Rect => ({
  minX: -width / 2,
  maxX: width / 2,
  minZ: -depth / 2,
  maxZ: depth / 2,
});

/** Corridor ids of a random world, named with `prefix`. */
const corridors = (prefix?: string) =>
  generateWorld({ seed: 3, corridorPrefix: prefix })
    .layout.rooms.filter((room) => room.kind === "corridor")
    .map((room) => room.id);

describe("translateLayout", () => {
  it("moves rooms and portals together and keeps the layout valid", () => {
    const world = portalWorld();
    const offset = { x: 40, z: -24 };
    const layout = translateLayout(world.layout, offset);
    layout.rooms.forEach((room, index) => {
      const before = world.layout.rooms[index];
      expect(room.position).toEqual([
        (before?.position[0] ?? 0) + 40,
        0,
        (before?.position[2] ?? 0) - 24,
      ]);
      room.portals?.forEach((portal, at) => {
        const shift = wallAxis(portal.wall) === "x" ? 40 : -24;
        expect(portal.along).toBe((before?.portals?.[at]?.along ?? 0) + shift);
      });
    });
    expect(checkLayout(world.graph, layout)).toEqual([]);
  });
});

describe("packOffsets", () => {
  it("keeps the first area in place and the rest AREA_GAP apart", () => {
    const bounds = [rect(20, 10), rect(31, 17), rect(8, 40), rect(100, 6)];
    const offsets = packOffsets(bounds);
    expect(offsets[0]).toEqual({ x: 0, z: 0 });
    const placed = bounds.map((bound, index) =>
      moved(bound, offsets[index]?.x ?? 0, offsets[index]?.z ?? 0)
    );
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        expect(rectGap(a, b)).toBeGreaterThanOrEqual(AREA_GAP);
      }
    }
    expect(packOffsets(bounds)).toEqual(offsets);
    expect(packOffsets([])).toEqual([]);
  });

  it("starts a new row once a row would pass SHELF_WIDTH", () => {
    const bounds = Array.from({ length: 8 }, () => rect(100, 20));
    const offsets = packOffsets(bounds);
    const rows = new Set(offsets.map((offset) => offset.z));
    expect(rows.size).toBeGreaterThan(1);
    for (const offset of offsets) {
      expect(offset.x + 50).toBeLessThanOrEqual(SHELF_WIDTH);
    }
  });
});

describe("corridor ids", () => {
  it("start with the prefix given, `corridor-` by default", () => {
    expect(corridors().length).toBeGreaterThan(0);
    expect(corridors().every((id) => /^corridor-\d+$/.test(id))).toBe(true);
    expect(
      corridors("a.ts/corridor-").every((id) =>
        /^a\.ts\/corridor-\d+$/.test(id)
      )
    ).toBe(true);
  });
});

describe("assembleAreas and mergeAreas", () => {
  const world = areaWorld();

  it("keeps the entry at the origin and knows the area of every unit", () => {
    expect(world.entry).toBe("one");
    expect(world.areas.map((area) => area.id)).toEqual(["one", "two", "three"]);
    expect(world.areas[0]?.offset).toEqual({ x: 0, z: 0 });
    expect(world.areaOf.get("work")).toBe("two");
    expect(world.areaOf.get("hub3")).toBe("three");
    for (const area of world.areas) {
      expect(area.bounds).toEqual(layoutBounds(area.layout.rooms));
    }
  });

  it("leaves portals into other areas without an arrival until merged", () => {
    const call = world.areas[0]?.built.portals.find(
      ({ portal }) => portal.id === "portal:main>work"
    );
    expect(call?.arrival).toBeNull();
    const merged = mergeAreas(world);
    const joined = merged.built.portals.find(
      ({ portal }) => portal.id === "portal:main>work"
    );
    const work = world.areas[1]?.layout.rooms.find(
      (room) => room.id === "work"
    );
    const landing = joined?.arrival?.position;
    expect(landing).toBeDefined();
    expect(
      work !== undefined &&
        landing !== undefined &&
        containsPoint(roomBounds(work), landing)
    ).toBe(true);
    expect(merged.built.start).toEqual(world.areas[0]?.built.start);
    expect(merged.built.rooms).toHaveLength(
      world.areas.reduce((sum, area) => sum + area.built.rooms.length, 0)
    );
    expect(merged.built.portals.every(({ arrival }) => arrival !== null)).toBe(
      true
    );
  });

  it("merges a single area into its own world", () => {
    const one = areaWorld();
    const single = { ...one, areas: one.areas.slice(0, 1) };
    expect(mergeAreas(single).built).toBe(one.areas[0]?.built);
  });
});
