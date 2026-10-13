import { WALL_HEIGHT } from "@repo/world-generator/config";
import { DataUtils, Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { bakeLightmap, faceOf, firstHit, occluders } from "./bake";
import type { BakedLightmap, BakeJob } from "./bake";
import { LIGHT_DROP } from "./fixtures";
import { layoutArea } from "./lightmap-layout";
import type { AreaLayout, LightmapFace } from "./lightmap-layout";
import { areaOf, testRoom } from "./test-rooms";

const LIGHT_Y = WALL_HEIGHT - LIGHT_DROP;

const jobFor = (layout: AreaLayout, lights: BakeJob["lights"]): BakeJob => ({
  layout,
  lights,
});

/** Mean luminance-ish (r + g + b) of a face's texels at (u, v) in 0..1. */
const sample = (
  lightmap: BakedLightmap,
  face: LightmapFace | undefined,
  u: number,
  v: number
): number => {
  const chart = face?.chart;
  if (chart === null || chart === undefined) {
    throw new Error("face has no chart");
  }
  const i = Math.min(chart.w - 1, Math.floor(u * chart.w));
  const j = Math.min(chart.h - 1, Math.floor(v * chart.h));
  const texel = (chart.y + j) * lightmap.width + chart.x + i;
  return [0, 1, 2].reduce(
    (sum, c) =>
      sum + DataUtils.fromHalfFloat(lightmap.data[texel * 4 + c] ?? 0),
    0
  );
};

/** One 4 × 4 room, light at its centre. */
const ONE = areaOf(testRoom("a", 0, 0, 4, 4));
const ONE_LAYOUT = layoutArea(ONE);
const ONE_BAKE = bakeLightmap(jobFor(ONE_LAYOUT, [[0, LIGHT_Y, 0]]));

/** Room a lit, room b dark, joined by a door. */
const TWO = areaOf(
  testRoom("a", 0, 0, 4, 4, ["east"]),
  testRoom("b", 4, 0, 4, 4, ["west"])
);
const TWO_LAYOUT = layoutArea(TWO);

/** The face of room `room` facing `sign` along `axis` at `at`. */
const faceAt = (
  layout: AreaLayout,
  room: number,
  match: Partial<LightmapFace>
): LightmapFace | undefined =>
  layout.rooms[room]?.find(
    (face) =>
      face.chart !== null &&
      Object.entries(match).every(
        ([key, value]) =>
          Math.abs(Number(face[key as keyof LightmapFace]) - Number(value)) <
          1e-6
      )
  );

describe("faceOf", () => {
  it("names the face a ray hit, whatever order the BVH keeps", () => {
    // Enough faces that building the tree reorders them.
    const rooms = Array.from({ length: 36 }, (_, i) =>
      testRoom(`r${i}`, (i % 6) * 5, Math.floor(i / 6) * 5, 4, 4)
    );
    const layout = layoutArea(areaOf(...rooms));
    const bvh = occluders(layout.faces);
    const ray = new Ray();
    rooms.forEach((built, index) => {
      const [x, , z] = built.room.position;
      ray.set(new Vector3(x + 0.3, 1, z - 0.2), new Vector3(0, -1, 0));
      const hit = firstHit(bvh, ray);
      const floor = layout.rooms[index]?.[0];
      expect(hit === null ? null : layout.faces[faceOf(hit) ?? -1]).toBe(floor);
    });
  });
});

describe("bakeLightmap", () => {
  it("is deterministic", () => {
    const again = bakeLightmap(jobFor(ONE_LAYOUT, [[0, LIGHT_Y, 0]]));
    expect(again.data).toEqual(ONE_BAKE.data);
  });

  it("lights a wall's inner face more than its outer face", () => {
    // The south wall (z = −2 side): its +z face looks into the room.
    const inner = faceAt(ONE_LAYOUT, 0, { axis: 2, sign: 1, at: -2 + 0.15 });
    const outer = faceAt(ONE_LAYOUT, 0, { axis: 2, sign: -1, at: -2 });
    expect(sample(ONE_BAKE, inner, 0.5, 0.5)).toBeGreaterThan(
      sample(ONE_BAKE, outer, 0.5, 0.5) + 0.05
    );
  });

  it("darkens a floor corner against the room centre", () => {
    const floor = ONE_LAYOUT.rooms[0]?.[0];
    // The second texel in from both walls (the first is under them), and
    // the middle.
    const corner = sample(ONE_BAKE, floor, 0.07, 0.07);
    const centre = sample(ONE_BAKE, floor, 0.5, 0.5);
    expect(corner).toBeLessThan(centre * 0.9);
  });

  it("fills floor texels under a wall from their neighbours, not black", () => {
    const floor = ONE_LAYOUT.rooms[0]?.[0];
    // u = 0 is under the west wall.
    expect(sample(ONE_BAKE, floor, 0, 0.5)).toBeGreaterThan(0.01);
  });

  it("bounces light through a door into an unlit room", () => {
    const bake = bakeLightmap(jobFor(TWO_LAYOUT, [[0, LIGHT_Y, 0]]));
    const dark = bakeLightmap(jobFor(TWO_LAYOUT, []));
    const floorA = TWO_LAYOUT.rooms[0]?.[0];
    const floorB = TWO_LAYOUT.rooms[1]?.[0];
    // Room b's floor near its door gains light over a bake without lights.
    const lit = sample(bake, floorB, 0.15, 0.5);
    const unlit = sample(dark, floorB, 0.15, 0.5);
    expect(lit).toBeGreaterThan(unlit);
    expect(lit).toBeLessThan(sample(bake, floorA, 0.5, 0.5));
  });
});
