import { createRng } from "@repo/world-generator/random";
import type { Rng } from "@repo/world-generator/random";
import {
  CanvasTexture,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import {
  carpetHeight,
  ceilingHeight,
  halveHeight,
  heightToNormal,
  heightToOrm,
  wallpaperHeight,
} from "./height-field";
import type { Rgba } from "./height-field";

/** Metres covered by one repeat of each texture. */
const TILE = { wallpaper: 1, carpet: 1, ceiling: 0.6 } as const;

/** Texels across the colour and normal maps; the ORM map is half that. */
const SIZE = 1024;

/** The painters below were drawn for a 512 canvas; their measures scale. */
const S = SIZE / 512;

const createCanvas = (size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2D canvas context is unavailable");
  }
  return { canvas, ctx };
};

/** Scatters single dark and light pixels for a grainy, worn look. */
const speckle = (
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  count: number,
  alpha: number,
  dotSize = 1
) => {
  for (let i = 0; i < count * S * S; i += 1) {
    const light = rng() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rng() * SIZE, rng() * SIZE, dotSize * S, dotSize * S);
  }
};

const toTexture = (
  canvas: HTMLCanvasElement,
  anisotropy: number,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace
): CanvasTexture => {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  return texture;
};

/** Mustard yellow with faint vertical stripes and a diamond motif. */
const drawWallpaper = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = "#cdb75c";
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "rgba(105,85,25,0.08)";
  for (let x = 0; x < SIZE; x += 32 * S) {
    ctx.fillRect(x, 0, 14 * S, SIZE);
  }

  ctx.strokeStyle = "rgba(120,95,30,0.22)";
  ctx.lineWidth = 2 * S;
  const cell = 128 * S;
  const half = cell / 2;
  for (let row = 0; row < SIZE / cell; row += 1) {
    for (let col = 0; col < SIZE / cell; col += 1) {
      const cx = col * cell + half;
      const cy = row * cell + half;
      ctx.beginPath();
      ctx.moveTo(cx, cy - half * 0.7);
      ctx.lineTo(cx + half * 0.45, cy);
      ctx.lineTo(cx, cy + half * 0.7);
      ctx.lineTo(cx - half * 0.45, cy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  speckle(ctx, createRng(1), 6000, 0.05);
};

/** Dull beige-brown carpet with dense speckling. */
const drawCarpet = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = "#8c7748";
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, createRng(2), 40_000, 0.12, 2);
  speckle(ctx, createRng(3), 12_000, 0.08);
};

/** One off-white drop-ceiling tile with a darker seam around it. */
const drawCeiling = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = "#d8d1ba";
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, createRng(4), 5000, 0.05, 2);
  ctx.strokeStyle = "#a59d86";
  ctx.lineWidth = 6 * S;
  ctx.strokeRect(0, 0, SIZE, SIZE);
};

/**
 * Lightens the colour on the height field's peaks and darkens its valleys,
 * so the relief reads even where the light falls flat on the surface.
 */
const shadeByHeight = (
  ctx: CanvasRenderingContext2D,
  height: Float32Array,
  amount: number
) => {
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const { data } = image;
  for (let i = 0; i < height.length; i += 1) {
    const factor = 1 + amount * ((height[i] ?? 0.5) - 0.5);
    data[i * 4] = (data[i * 4] ?? 0) * factor;
    data[i * 4 + 1] = (data[i * 4 + 1] ?? 0) * factor;
    data[i * 4 + 2] = (data[i * 4 + 2] ?? 0) * factor;
  }
  ctx.putImageData(image, 0, 0);
};

const dataCanvas = (rgba: Rgba, size: number): HTMLCanvasElement => {
  const { canvas, ctx } = createCanvas(size);
  ctx.putImageData(new ImageData(rgba, size, size), 0, 0);
  return canvas;
};

type SurfaceMaps = {
  readonly map: CanvasTexture;
  readonly normalMap: CanvasTexture;
  /** R occlusion, G roughness: one texture serves `aoMap` and `roughnessMap`. */
  readonly orm: CanvasTexture;
};

type SurfaceLook = {
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
  readonly height: (size: number) => Float32Array;
  /** How steep the normal map reads the height field. */
  readonly relief: number;
  /** How much the height field shades the colour map. */
  readonly shade: number;
  readonly roughness: number;
  readonly spread: number;
  readonly cavity: number;
};

const surfaceMaps = (
  { draw, height, relief, shade, roughness, spread, cavity }: SurfaceLook,
  anisotropy: number
): SurfaceMaps => {
  const field = height(SIZE);
  const colour = createCanvas(SIZE);
  draw(colour.ctx);
  shadeByHeight(colour.ctx, field, shade);
  const normal = dataCanvas(heightToNormal(field, SIZE, relief), SIZE);
  const half = SIZE / 2;
  const orm = dataCanvas(
    heightToOrm(halveHeight(field, SIZE), half, { roughness, spread, cavity }),
    half
  );
  return {
    map: toTexture(colour.canvas, anisotropy, SRGBColorSpace),
    normalMap: toTexture(normal, anisotropy, NoColorSpace),
    orm: toTexture(orm, anisotropy, NoColorSpace),
  };
};

const WALLPAPER: SurfaceLook = {
  draw: drawWallpaper,
  height: wallpaperHeight,
  relief: 6,
  shade: 0.3,
  roughness: 0.85,
  spread: 0.1,
  cavity: 2,
};

const CARPET: SurfaceLook = {
  draw: drawCarpet,
  height: carpetHeight,
  relief: 10,
  shade: 0.5,
  roughness: 0.97,
  spread: 0.03,
  cavity: 3,
};

const CEILING: SurfaceLook = {
  draw: drawCeiling,
  height: ceilingHeight,
  relief: 8,
  shade: 0.4,
  roughness: 0.92,
  spread: 0.06,
  cavity: 3,
};

type SurfaceTextures = {
  readonly wallpaper: SurfaceMaps;
  readonly carpet: SurfaceMaps;
  readonly ceiling: SurfaceMaps;
};

/**
 * Colour, normal and occlusion-roughness maps for each surface, generated
 * once per Canvas from seeded height fields: nothing is fetched.
 */
const createSurfaceTextures = (anisotropy: number): SurfaceTextures => ({
  wallpaper: surfaceMaps(WALLPAPER, anisotropy),
  carpet: surfaceMaps(CARPET, anisotropy),
  ceiling: surfaceMaps(CEILING, anisotropy),
});

export { createSurfaceTextures, TILE };
export type { SurfaceMaps };
