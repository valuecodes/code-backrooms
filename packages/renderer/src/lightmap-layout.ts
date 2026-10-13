import type { BuiltWorld, Vec3, WallSegment } from "@repo/types";
import { WALL_HEIGHT } from "@repo/world-generator/config";
import { Float32BufferAttribute } from "three";
import type { BufferGeometry } from "three";

import type { Rgb } from "./lane-tint";
import { segmentColour } from "./wall-colour";

// Every surface the bake lights, as an axis-aligned rectangle, and its patch
// (chart) in the area's lightmap. Shared by the page, which writes each
// mesh's `uv1` from it, and the bake worker, which fills the texels: both
// place a face by projecting onto its two tangent axes, so they agree on
// where a texel lies without depending on any geometry's vertex order.

/** World axis index: 0 = x, 1 = y, 2 = z. */
type Axis = 0 | 1 | 2;

/** A rectangle of texels in the atlas: the chart's interior, gutter excluded. */
type Chart = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * One flat, axis-aligned face. It lies in the plane `axis = at`, faces
 * `sign` along that axis and spans [min, max] on its tangent axes, which
 * are the other two axes in x, y, z order.
 */
type LightmapFace = {
  readonly axis: Axis;
  readonly sign: 1 | -1;
  readonly at: number;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  /** Linear diffuse colour, for light bounced off it. */
  readonly albedo: Rgb;
  /** Its texels; null for a face no one sees (on the floor, under the ceiling). */
  readonly chart: Chart | null;
  /** Index of its room in the area, for the solids it may sit inside. */
  readonly room: number;
};

/** An axis-aligned box: a wall segment, as the bake sees it. */
type Solid = {
  readonly min: Vec3;
  readonly max: Vec3;
};

type AreaLayout = {
  readonly width: number;
  readonly height: number;
  /** Metres per texel. */
  readonly texel: number;
  readonly faces: readonly LightmapFace[];
  /**
   * Each room's faces, a run of `faces`: floor, ceiling, then the six faces
   * of every wall segment in `BoxGeometry` order (+x, −x, +y, −y, +z, −z),
   * so a room's merged walls line up with them four vertices a face.
   */
  readonly rooms: readonly (readonly LightmapFace[])[];
  /** Each room's wall segments, as solids. */
  readonly solids: readonly (readonly Solid[])[];
};

/**
 * Metres per texel, before an area too large for the budget doubles it.
 * Bounce light is soft, so half a metre holds it; contact shadows come from
 * the surface maps' own occlusion. At 0.25 m a typical area of the
 * repository's own world took 6 s to bake.
 */
const TEXEL = 0.5;
/**
 * At most this many texels in one area's atlas: 1 MiB of half-float RGBA,
 * and a few seconds' bake for the largest area of the repository's world.
 */
const MAX_TEXELS = 128 * 1024;
/** Longest atlas side. */
const MAX_ATLAS = 1024;
/** The coarsest texel: no face is wider than a few of these. */
const MAX_TEXEL = 8;
/** A face this close to the floor or ceiling is against it, unseen. */
const FLUSH = 0.01;

/**
 * Mean linear colour of each surface's albedo map: the painter's base colour
 * in `textures.ts`, a few per cent darker for its pattern and speckle.
 */
const ALBEDO = {
  wallpaper: [0.59, 0.46, 0.1],
  carpet: [0.25, 0.175, 0.062],
  ceiling: [0.67, 0.62, 0.48],
} as const satisfies Record<string, Rgb>;

const times = ([r, g, b]: Rgb, [tr, tg, tb]: Rgb): Rgb => [
  r * tr,
  g * tg,
  b * tb,
];

const TANGENTS = [
  [1, 2],
  [0, 2],
  [0, 1],
] as const satisfies readonly (readonly [Axis, Axis])[];

/** The two tangent axes of a face on `axis`, in x, y, z order. */
const tangents = (axis: Axis): readonly [Axis, Axis] => TANGENTS[axis];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

type Draft = Omit<LightmapFace, "chart"> & { readonly visible: boolean };

/** A box's six faces in `BoxGeometry` order. */
const boxFaces = (
  { min, max }: Solid,
  albedo: Rgb,
  room: number,
  floor: number,
  ceiling: number
): Draft[] =>
  ([0, 1, 2] as const).flatMap((axis) => {
    const [a, b] = tangents(axis);
    const span = {
      min: [min[a], min[b]] as const,
      max: [max[a], max[b]] as const,
    };
    // The top is against the ceiling and the bottom on the floor, except
    // for a lintel's underside over a door.
    const top = axis !== 1 || max[1] < ceiling - FLUSH;
    const bottom = axis !== 1 || min[1] > floor + FLUSH;
    return [
      { axis, sign: 1, at: max[axis], ...span, albedo, room, visible: top },
      { axis, sign: -1, at: min[axis], ...span, albedo, room, visible: bottom },
    ] as const;
  });

const solidOf = ({ center, size }: WallSegment): Solid => ({
  min: [
    center[0] - size[0] / 2,
    center[1] - size[1] / 2,
    center[2] - size[2] / 2,
  ],
  max: [
    center[0] + size[0] / 2,
    center[1] + size[1] / 2,
    center[2] + size[2] / 2,
  ],
});

/** What the layout reads of an area: its built rooms. */
type AreaRooms = { readonly built: Pick<BuiltWorld, "rooms"> };

/** Every face of an area, room by room, before any chart is placed. */
const draftFaces = (area: AreaRooms) => {
  const drafts: Draft[] = [];
  const roomStart: number[] = [];
  const solids: Solid[][] = [];
  area.built.rooms.forEach(({ room, segments }, index) => {
    roomStart.push(drafts.length);
    const [x, y, z] = room.position;
    const top = y + WALL_HEIGHT;
    const span = {
      min: [x - room.width / 2, z - room.depth / 2] as const,
      max: [x + room.width / 2, z + room.depth / 2] as const,
    };
    drafts.push(
      {
        axis: 1,
        sign: 1,
        at: y,
        ...span,
        albedo: ALBEDO.carpet,
        room: index,
        visible: true,
      },
      {
        axis: 1,
        sign: -1,
        at: top,
        ...span,
        albedo: ALBEDO.ceiling,
        room: index,
        visible: true,
      }
    );
    const boxes = segments.map(solidOf);
    solids.push(boxes);
    segments.forEach((segment, i) => {
      const albedo = times(ALBEDO.wallpaper, segmentColour(segment, room.id));
      const box = boxes[i];
      if (box !== undefined) {
        drafts.push(...boxFaces(box, albedo, index, y, top));
      }
    });
  });
  return { drafts, roomStart, solids };
};

/** Texels a face needs at `texel` metres each: at least one per side. */
const chartSize = (face: Draft, texel: number) => ({
  w: Math.max(1, Math.ceil((face.max[0] - face.min[0]) / texel - 1e-6)),
  h: Math.max(1, Math.ceil((face.max[1] - face.min[1]) / texel - 1e-6)),
});

const roundUp4 = (value: number): number => Math.ceil(value / 4) * 4;

/**
 * Shelf-packs the visible faces' charts, each with a one-texel gutter, the
 * tallest first: an atlas as wide as the widest chart or a bit over the
 * square root of the total, whichever is more.
 */
const pack = (drafts: readonly Draft[], texel: number) => {
  const sizes = drafts.map((draft) =>
    draft.visible ? chartSize(draft, texel) : null
  );
  let total = 0;
  let widest = 0;
  for (const size of sizes) {
    if (size !== null) {
      total += (size.w + 2) * (size.h + 2);
      widest = Math.max(widest, size.w + 2);
    }
  }
  const width = roundUp4(Math.max(widest, Math.ceil(Math.sqrt(total) * 1.1)));
  const order = sizes
    .map((size, index) => ({ size, index }))
    .filter(
      (entry): entry is { size: { w: number; h: number }; index: number } =>
        entry.size !== null
    )
    .sort((p, q) => q.size.h - p.size.h || p.index - q.index);
  const charts: (Chart | null)[] = sizes.map(() => null);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { size, index } of order) {
    if (x + size.w + 2 > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    charts[index] = { x: x + 1, y: y + 1, w: size.w, h: size.h };
    x += size.w + 2;
    shelf = Math.max(shelf, size.h + 2);
  }
  return { width, height: Math.max(1, y + shelf), charts };
};

/**
 * The area's lightmap: its faces and where each one's texels lie. An area
 * too big for the texel budget is laid out again at twice the texel size,
 * as often as it takes.
 */
const layoutArea = (area: AreaRooms): AreaLayout => {
  const { drafts, roomStart, solids } = draftFaces(area);
  let texel = TEXEL;
  let packed = pack(drafts, texel);
  // Every face keeps at least one texel and its gutter, so past some size
  // doubling gains nothing: stop at MAX_TEXEL and take the atlas as it is.
  while (
    texel < MAX_TEXEL &&
    (packed.width * packed.height > MAX_TEXELS ||
      packed.width > MAX_ATLAS ||
      packed.height > MAX_ATLAS)
  ) {
    texel *= 2;
    packed = pack(drafts, texel);
  }
  const faces = drafts.map(
    ({ visible: _visible, ...face }, index): LightmapFace => ({
      ...face,
      chart: packed.charts[index] ?? null,
    })
  );
  return {
    width: packed.width,
    height: packed.height,
    texel,
    faces,
    rooms: roomStart.map((start, room) =>
      faces.slice(start, roomStart[room + 1] ?? faces.length)
    ),
    solids,
  };
};

/** Where a point on a face falls in its chart, 0..1 on each tangent axis. */
const faceUv = (
  face: LightmapFace,
  a: number,
  b: number
): readonly [number, number] => [
  clamp01((a - face.min[0]) / (face.max[0] - face.min[0] || 1)),
  clamp01((b - face.min[1]) / (face.max[1] - face.min[1] || 1)),
];

/**
 * Writes a `uv1` attribute: each run of `perFace` vertices is the next face
 * of `faces`, and its vertices map onto that face's chart by their world
 * position. A face without a chart maps to the atlas origin; it is never
 * seen. The geometry must be in world space.
 */
const writeLightmapUv = (
  geometry: BufferGeometry,
  faces: readonly LightmapFace[],
  layout: Pick<AreaLayout, "width" | "height">,
  perFace: number
): void => {
  const position = geometry.getAttribute("position");
  const data = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const face = faces[Math.floor(i / perFace)];
    if (face?.chart === null || face === undefined) {
      continue;
    }
    const [ta, tb] = tangents(face.axis);
    const point = [position.getX(i), position.getY(i), position.getZ(i)];
    const [u, v] = faceUv(face, point[ta] ?? 0, point[tb] ?? 0);
    const { chart } = face;
    data[i * 2] = (chart.x + u * chart.w) / layout.width;
    data[i * 2 + 1] = (chart.y + v * chart.h) / layout.height;
  }
  geometry.setAttribute("uv1", new Float32BufferAttribute(data, 2));
};

export { faceUv, layoutArea, MAX_TEXELS, tangents, TEXEL, writeLightmapUv };
export type { AreaLayout, AreaRooms, Chart, LightmapFace, Solid };
