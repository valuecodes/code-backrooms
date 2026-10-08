import { createRng } from "@repo/world-generator/random";
import type { Rng } from "@repo/world-generator/random";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/** Metres covered by one repeat of each texture. */
const TILE = { wallpaper: 1, carpet: 1, ceiling: 0.6 } as const;

const SIZE = 512;

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
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
  for (let i = 0; i < count; i += 1) {
    const light = rng() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rng() * SIZE, rng() * SIZE, dotSize, dotSize);
  }
};

const toTexture = (
  canvas: HTMLCanvasElement,
  anisotropy: number
): CanvasTexture => {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
};

/** Mustard yellow with faint vertical stripes and a diamond motif. */
const drawWallpaper = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = "#cdb75c";
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "rgba(105,85,25,0.08)";
  for (let x = 0; x < SIZE; x += 32) {
    ctx.fillRect(x, 0, 14, SIZE);
  }

  ctx.strokeStyle = "rgba(120,95,30,0.22)";
  ctx.lineWidth = 2;
  const cell = 128;
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
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, SIZE, SIZE);
};

type SurfaceTextures = {
  readonly wallpaper: CanvasTexture;
  readonly carpet: CanvasTexture;
  readonly ceiling: CanvasTexture;
};

const createSurfaceTextures = (anisotropy: number): SurfaceTextures => {
  const wallpaper = createCanvas();
  drawWallpaper(wallpaper.ctx);
  const carpet = createCanvas();
  drawCarpet(carpet.ctx);
  const ceiling = createCanvas();
  drawCeiling(ceiling.ctx);
  return {
    wallpaper: toTexture(wallpaper.canvas, anisotropy),
    carpet: toTexture(carpet.canvas, anisotropy),
    ceiling: toTexture(ceiling.canvas, anisotropy),
  };
};

export { createSurfaceTextures, TILE };
