import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataUtils,
  DoubleSide,
  Ray,
  Vector3,
} from "three";
import type { Intersection } from "three";
import { MeshBVH } from "three-mesh-bvh";

import { LIGHT_COLOR, LIGHT_DISTANCE, LIGHT_INTENSITY } from "./fixtures";
import type { Rgb } from "./lane-tint";
import { faceUv, tangents } from "./lightmap-layout";
import type { AreaLayout, LightmapFace, Solid } from "./lightmap-layout";

// Bakes an area's indirect light into its lightmap: one bounce of the
// fixtures' light off the walls, floor and ceiling, plus a flat fill that
// the surroundings occlude. Direct light is not stored: the light pool
// draws it live. Values are irradiance on three's scale, which is what
// `MeshStandardMaterial.lightMap` adds to the indirect diffuse.

/** What the worker needs: the layout's faces and solids, and the lights. */
type BakeJob = {
  readonly layout: Pick<
    AreaLayout,
    "width" | "height" | "texel" | "faces" | "solids"
  >;
  /** Each fixture's light point, world space. */
  readonly lights: readonly (readonly [number, number, number])[];
};

type BakedLightmap = {
  readonly width: number;
  readonly height: number;
  /** RGBA half floats, row by row from the atlas origin. */
  readonly data: Uint16Array;
};

/** Hemisphere rays per texel. */
const SAMPLES = 16;
/** Surroundings closer than this occlude the fill. */
const AO_RADIUS = 1.5;
/** Scales the bounce; 1 is physical. */
const BOUNCE_GAIN = 1;
/**
 * The fill an open texel gets on top of the bounce: light from beyond the
 * area's fixtures and from bounces past the first, as a warm constant.
 */
const AMBIENT_FILL: Rgb = [0.08, 0.065, 0.038];
/** The light pool's flicker averages this over time. */
const FLICKER_MEAN = 0.93;
/** How far a texel or ray start sits off its face. */
const LIFT = 1e-3;
/** Dilation passes before the leftovers take their chart's mean. */
const DILATE_PASSES = 4;

const lightColour = new Color(LIGHT_COLOR);
const LIGHT_RGB: Rgb = [lightColour.r, lightColour.g, lightColour.b];

/** three's punctual falloff: inverse square, windowed to zero at the cutoff. */
const falloff = (distance: number): number => {
  const window = Math.min(1, Math.max(0, 1 - (distance / LIGHT_DISTANCE) ** 4));
  return (window * window) / Math.max(distance * distance, 0.01);
};

/** Van der Corput radical inverse in base 2. */
const radicalInverse = (index: number): number => {
  let bits = index;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55_55_55_55) << 1) | ((bits & 0xaa_aa_aa_aa) >>> 1)) >>> 0;
  bits = (((bits & 0x33_33_33_33) << 2) | ((bits & 0xcc_cc_cc_cc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f_0f_0f_0f) << 4) | ((bits & 0xf0_f0_f0_f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00_ff_00_ff) << 8) | ((bits & 0xff_00_ff_00) >>> 8)) >>> 0;
  return bits / 2 ** 32;
};

/**
 * A fixed Hammersley set of cosine-weighted directions about +z: the same
 * every bake, so the result is deterministic.
 */
const HEMISPHERE = Array.from({ length: SAMPLES }, (_, i) => {
  const u = (i + 0.5) / SAMPLES;
  const phi = 2 * Math.PI * radicalInverse(i);
  const r = Math.sqrt(u);
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)] as const;
});

/** A per-texel turn of the sample set, so neighbours do not band together. */
const turnOf = (index: number): number => {
  let h = Math.imul(index ^ 0x9e_37_79_b9, 0x85_eb_ca_6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2_b2_ae_35);
  return (((h ^ (h >>> 16)) >>> 0) / 2 ** 32) * 2 * Math.PI;
};

/**
 * The nearest hit along a ray, or null: `raycastFirst` returns null on a
 * miss though its typings say otherwise.
 */
const firstHit = (
  bvh: MeshBVH,
  ray: Ray,
  far = Infinity
): Intersection | null => bvh.raycastFirst(ray, DoubleSide, 0, far);

/** Each face is six vertices of the occluder geometry, in face order. */
const VERTICES_PER_FACE = 6;

/**
 * The face a ray hit. Not from `faceIndex`: building the BVH reorders the
 * triangles behind an index it adds, and `faceIndex` counts in that new
 * order. The hit triangle's vertex indices still name the original vertices.
 */
const faceOf = (hit: Intersection): number | null =>
  hit.face ? Math.floor(hit.face.a / VERTICES_PER_FACE) : null;

/** One BVH over every face, two triangles each, non-indexed. */
const occluders = (faces: readonly LightmapFace[]): MeshBVH => {
  const positions = new Float32Array(faces.length * VERTICES_PER_FACE * 3);
  faces.forEach((face, f) => {
    const [a, b] = tangents(face.axis);
    const corner = (s: number, t: number) => {
      const point = [0, 0, 0];
      point[face.axis] = face.at;
      point[a] = s;
      point[b] = t;
      return point;
    };
    const p00 = corner(face.min[0], face.min[1]);
    const p10 = corner(face.max[0], face.min[1]);
    const p11 = corner(face.max[0], face.max[1]);
    const p01 = corner(face.min[0], face.max[1]);
    positions.set(
      [...p00, ...p10, ...p11, ...p00, ...p11, ...p01],
      f * VERTICES_PER_FACE * 3
    );
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  return new MeshBVH(geometry);
};

const inside = (point: readonly number[], solids: readonly Solid[]): boolean =>
  solids.some(({ min, max }) =>
    [0, 1, 2].every((axis) => {
      const value = point[axis] ?? 0;
      return value > (min[axis] ?? 0) && value < (max[axis] ?? 0);
    })
  );

/**
 * Bakes one area. Each visible face's texels get, in turn: the direct light
 * of every fixture in reach, with a shadow ray each (kept only to bounce);
 * then `SAMPLES` rays over the hemisphere, gathering what the surfaces they
 * hit reflect, and counting how many leave within `AO_RADIUS` for the fill.
 * Texels buried in a wall, and the gutters, are filled from their
 * neighbours so filtering never pulls black onto a visible edge.
 */
const bakeLightmap = ({ layout, lights }: BakeJob): BakedLightmap => {
  const { width, height, faces, solids } = layout;
  const bvh = occluders(faces);
  const texels = width * height;
  const valid = new Uint8Array(texels);
  /** Each texel's world point, kept from the direct pass for the bounce. */
  const points = new Float32Array(texels * 3);
  const owner = new Int32Array(texels).fill(-1);
  const direct = new Float32Array(texels * 3);
  const ray = new Ray();
  const toLight = new Vector3();

  // Direct light, texel by texel.
  faces.forEach((face, f) => {
    const { chart } = face;
    if (chart === null) {
      return;
    }
    const [a, b] = tangents(face.axis);
    for (let j = 0; j < chart.h; j += 1) {
      for (let i = 0; i < chart.w; i += 1) {
        const texel = (chart.y + j) * width + chart.x + i;
        owner[texel] = f;
        const point = [0, 0, 0];
        point[face.axis] = face.at + face.sign * LIFT;
        point[a] =
          face.min[0] + ((i + 0.5) / chart.w) * (face.max[0] - face.min[0]);
        point[b] =
          face.min[1] + ((j + 0.5) / chart.h) * (face.max[1] - face.min[1]);
        if (inside(point, solids[face.room] ?? [])) {
          continue;
        }
        valid[texel] = 1;
        points.set(point, texel * 3);
        let e = 0;
        for (const light of lights) {
          toLight.set(
            light[0] - (point[0] ?? 0),
            light[1] - (point[1] ?? 0),
            light[2] - (point[2] ?? 0)
          );
          const distance = toLight.length();
          const cos = (toLight.getComponent(face.axis) * face.sign) / distance;
          if (distance >= LIGHT_DISTANCE || cos <= 0) {
            continue;
          }
          ray.origin.fromArray(point);
          ray.direction.copy(toLight).divideScalar(distance);
          if (firstHit(bvh, ray, distance - LIFT) !== null) {
            continue;
          }
          e += cos * falloff(distance);
        }
        const scale = LIGHT_INTENSITY * FLICKER_MEAN * e;
        direct[texel * 3] = LIGHT_RGB[0] * scale;
        direct[texel * 3 + 1] = LIGHT_RGB[1] * scale;
        direct[texel * 3 + 2] = LIGHT_RGB[2] * scale;
      }
    }
  });

  /** What a surface point reflects: its albedo times its direct light. */
  const reflected = (f: number, point: Vector3, into: number[]) => {
    const face = faces[f];
    const chart = face?.chart;
    if (face === undefined || chart === null || chart === undefined) {
      return;
    }
    const [a, b] = tangents(face.axis);
    const [u, v] = faceUv(face, point.getComponent(a), point.getComponent(b));
    const i = Math.min(chart.w - 1, Math.floor(u * chart.w));
    const j = Math.min(chart.h - 1, Math.floor(v * chart.h));
    const texel = (chart.y + j) * width + chart.x + i;
    into[0] = (into[0] ?? 0) + face.albedo[0] * (direct[texel * 3] ?? 0);
    into[1] = (into[1] ?? 0) + face.albedo[1] * (direct[texel * 3 + 1] ?? 0);
    into[2] = (into[2] ?? 0) + face.albedo[2] * (direct[texel * 3 + 2] ?? 0);
  };

  // The bounce and the occluded fill.
  const out = new Float32Array(texels * 3);
  const gathered = [0, 0, 0];
  for (let texel = 0; texel < texels; texel += 1) {
    const face = faces[owner[texel] ?? -1];
    if (valid[texel] !== 1 || face === undefined) {
      continue;
    }
    const [a, b] = tangents(face.axis);
    const turn = turnOf(texel);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    gathered[0] = 0;
    gathered[1] = 0;
    gathered[2] = 0;
    let open = 0;
    ray.origin.fromArray(points, texel * 3);
    for (const [sx, sy, sz] of HEMISPHERE) {
      ray.direction.set(0, 0, 0);
      ray.direction.setComponent(a, sx * cos - sy * sin);
      ray.direction.setComponent(b, sx * sin + sy * cos);
      ray.direction.setComponent(face.axis, sz * face.sign);
      const hit = firstHit(bvh, ray);
      if (hit === null || hit.distance > AO_RADIUS) {
        open += 1;
      }
      const struck = hit === null ? null : faceOf(hit);
      if (hit !== null && struck !== null) {
        reflected(struck, hit.point, gathered);
      }
    }
    const fill = open / SAMPLES;
    for (let c = 0; c < 3; c += 1) {
      out[texel * 3 + c] =
        ((gathered[c] ?? 0) / SAMPLES) * BOUNCE_GAIN +
        (AMBIENT_FILL[c] ?? 0) * fill;
    }
  }

  smooth(out, valid, faces, width);
  dilate(out, valid, faces, width);
  const data = new Uint16Array(texels * 4);
  for (let texel = 0; texel < texels; texel += 1) {
    data[texel * 4] = DataUtils.toHalfFloat(out[texel * 3] ?? 0);
    data[texel * 4 + 1] = DataUtils.toHalfFloat(out[texel * 3 + 1] ?? 0);
    data[texel * 4 + 2] = DataUtils.toHalfFloat(out[texel * 3 + 2] ?? 0);
    data[texel * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  bvh.geometry.dispose();
  return { width, height, data };
};

/** A 3 × 3 tent: the texel itself 4, its sides 2, its corners 1. */
const TENT = [1, 2, 1, 2, 4, 2, 1, 2, 1];

/**
 * One tent-filter pass over each chart's valid texels: a few rays a texel
 * leave the bounce noisy, and bounce light is soft enough that a texel's
 * neighbours are as good an estimate as its own rays. Reads from a copy,
 * stays inside the chart and skips texels buried in a wall.
 */
const smooth = (
  out: Float32Array,
  valid: Uint8Array,
  faces: readonly LightmapFace[],
  width: number
): void => {
  const source = Float32Array.from(out);
  for (const { chart } of faces) {
    if (chart === null) {
      continue;
    }
    for (let y: number = chart.y; y < chart.y + chart.h; y += 1) {
      for (let x: number = chart.x; x < chart.x + chart.w; x += 1) {
        const texel = y * width + x;
        if (valid[texel] !== 1) {
          continue;
        }
        const sum = [0, 0, 0];
        let weight = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            const near = ny * width + nx;
            const w = TENT[(dy + 1) * 3 + dx + 1] ?? 0;
            if (
              nx < chart.x ||
              nx >= chart.x + chart.w ||
              ny < chart.y ||
              ny >= chart.y + chart.h ||
              valid[near] !== 1
            ) {
              continue;
            }
            sum[0] = (sum[0] ?? 0) + w * (source[near * 3] ?? 0);
            sum[1] = (sum[1] ?? 0) + w * (source[near * 3 + 1] ?? 0);
            sum[2] = (sum[2] ?? 0) + w * (source[near * 3 + 2] ?? 0);
            weight += w;
          }
        }
        out[texel * 3] = (sum[0] ?? 0) / weight;
        out[texel * 3 + 1] = (sum[1] ?? 0) / weight;
        out[texel * 3 + 2] = (sum[2] ?? 0) / weight;
      }
    }
  }
};

/**
 * Fills every texel of a chart's padded rectangle that has no value (buried
 * in a wall, or the gutter) with the mean of its filled neighbours, pass by
 * pass; what is still empty after that takes the chart's mean. Stays inside
 * each chart, so charts never bleed into one another.
 */
const dilate = (
  out: Float32Array,
  valid: Uint8Array,
  faces: readonly LightmapFace[],
  width: number
): void => {
  for (const { chart } of faces) {
    if (chart === null) {
      continue;
    }
    const x0 = chart.x - 1;
    const y0 = chart.y - 1;
    const x1 = chart.x + chart.w;
    const y1 = chart.y + chart.h;
    for (let pass = 0; pass < DILATE_PASSES; pass += 1) {
      const filled: number[] = [];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const texel = y * width + x;
          if (valid[texel] === 1) {
            continue;
          }
          const sum = [0, 0, 0];
          let count = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              const near = ny * width + nx;
              if (
                nx < x0 ||
                nx > x1 ||
                ny < y0 ||
                ny > y1 ||
                valid[near] !== 1
              ) {
                continue;
              }
              sum[0] = (sum[0] ?? 0) + (out[near * 3] ?? 0);
              sum[1] = (sum[1] ?? 0) + (out[near * 3 + 1] ?? 0);
              sum[2] = (sum[2] ?? 0) + (out[near * 3 + 2] ?? 0);
              count += 1;
            }
          }
          if (count > 0) {
            out[texel * 3] = (sum[0] ?? 0) / count;
            out[texel * 3 + 1] = (sum[1] ?? 0) / count;
            out[texel * 3 + 2] = (sum[2] ?? 0) / count;
            filled.push(texel);
          }
        }
      }
      // Marked after the pass, so one pass grows the filled region by one.
      for (const texel of filled) {
        valid[texel] = 1;
      }
    }
    const mean = [0, 0, 0];
    let count = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const texel = y * width + x;
        if (valid[texel] === 1) {
          mean[0] = (mean[0] ?? 0) + (out[texel * 3] ?? 0);
          mean[1] = (mean[1] ?? 0) + (out[texel * 3 + 1] ?? 0);
          mean[2] = (mean[2] ?? 0) + (out[texel * 3 + 2] ?? 0);
          count += 1;
        }
      }
    }
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const texel = y * width + x;
        if (valid[texel] !== 1) {
          out[texel * 3] = count > 0 ? (mean[0] ?? 0) / count : 0;
          out[texel * 3 + 1] = count > 0 ? (mean[1] ?? 0) / count : 0;
          out[texel * 3 + 2] = count > 0 ? (mean[2] ?? 0) / count : 0;
        }
      }
    }
  }
};

export { bakeLightmap, faceOf, firstHit, occluders };
export type { BakedLightmap, BakeJob };
