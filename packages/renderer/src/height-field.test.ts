import { describe, expect, it } from "vitest";

import {
  carpetHeight,
  ceilingHeight,
  downsample,
  fbm,
  heightToNormal,
  heightToOrm,
  wallpaperHeight,
} from "./height-field";

const SIZE = 64;

/** The largest step between neighbours inside the field, per axis. */
const interiorSteps = (
  height: Float32Array,
  size: number
): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const h = height[row * size + col] ?? 0;
      if (col < size - 1) {
        x = Math.max(x, Math.abs((height[row * size + col + 1] ?? 0) - h));
      }
      if (row < size - 1) {
        y = Math.max(y, Math.abs((height[(row + 1) * size + col] ?? 0) - h));
      }
    }
  }
  return { x, y };
};

/** The largest step across the wrap edge, last column → first, last row → first. */
const wrapSteps = (
  height: Float32Array,
  size: number
): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  for (let i = 0; i < size; i += 1) {
    x = Math.max(
      x,
      Math.abs((height[i * size] ?? 0) - (height[i * size + size - 1] ?? 0))
    );
    y = Math.max(
      y,
      Math.abs((height[i] ?? 0) - (height[(size - 1) * size + i] ?? 0))
    );
  }
  return { x, y };
};

describe("heightToNormal", () => {
  it("maps a flat field to straight-up normals", () => {
    const normal = heightToNormal(new Float32Array(16).fill(0.5), 4, 8);
    for (let i = 0; i < 16; i += 1) {
      expect([...normal.slice(i * 4, i * 4 + 4)]).toEqual([128, 128, 255, 255]);
    }
  });

  it("tilts only R for a slope along x, away from the rise", () => {
    const size = 8;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        height[y * size + x] = x / size;
      }
    }
    const normal = heightToNormal(height, size, 4);
    const i = (3 * size + 3) * 4;
    expect(normal[i]).toBeLessThan(128);
    expect(normal[i + 1]).toBe(128);
    expect(normal[i + 2]).toBeGreaterThan(200);
  });

  it("wraps at the edges, so a step at column 0 shows at the last column", () => {
    const size = 8;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      height[y * size] = 1;
    }
    const normal = heightToNormal(height, size, 1);
    const last = (2 * size + size - 1) * 4;
    const middle = (2 * size + 4) * 4;
    expect(normal[last]).not.toBe(128);
    expect(normal[middle]).toBe(128);
  });
});

describe("heightToOrm", () => {
  it("keeps roughness inside the spread and has no metalness", () => {
    const height = fbm(1, SIZE, { octaves: 3, cells: 8 });
    const orm = heightToOrm(height, SIZE, {
      roughness: 0.8,
      spread: 0.1,
      cavity: 2,
    });
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(orm[i * 4 + 1]).toBeGreaterThanOrEqual(Math.floor(0.7 * 255));
      expect(orm[i * 4 + 1]).toBeLessThanOrEqual(Math.ceil(0.9 * 255));
      expect(orm[i * 4 + 2]).toBe(255);
    }
  });

  it("occludes a pit and leaves a plain around it lit", () => {
    const height = new Float32Array(SIZE * SIZE).fill(0.8);
    height[32 * SIZE + 32] = 0;
    const orm = heightToOrm(height, SIZE, {
      roughness: 0.5,
      spread: 0,
      cavity: 2,
    });
    expect(orm[(32 * SIZE + 32) * 4]).toBeLessThan(
      orm[(2 * SIZE + 2) * 4] ?? 0
    );
    expect(orm[(2 * SIZE + 2) * 4]).toBe(255);
  });
});

describe("downsample", () => {
  it("averages each 2 × 2 block", () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    [0, 100, 200, 100].forEach((value, texel) => {
      rgba[texel * 4] = value;
      rgba[texel * 4 + 3] = 255;
    });
    const half = downsample(rgba, 2);
    expect([...half]).toEqual([100, 0, 0, 255]);
  });
});

describe("surface height fields", () => {
  const surfaces = {
    wallpaper: wallpaperHeight,
    carpet: carpetHeight,
    ceiling: ceilingHeight,
  };

  for (const [name, generate] of Object.entries(surfaces)) {
    it(`${name} is deterministic`, () => {
      expect(generate(SIZE)).toEqual(generate(SIZE));
    });

    it(`${name} stays in [0, 1]`, () => {
      const height = generate(SIZE);
      for (const value of height) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it(`${name} is seamless across the wrap edge`, () => {
      const height = generate(SIZE);
      const inside = interiorSteps(height, SIZE);
      const across = wrapSteps(height, SIZE);
      expect(across.x).toBeLessThanOrEqual(inside.x);
      expect(across.y).toBeLessThanOrEqual(inside.y);
    });
  }

  it("fbm tiles: the step across the edge is no larger than inside", () => {
    const height = fbm(5, SIZE, { octaves: 4, cells: 4 });
    const inside = interiorSteps(height, SIZE);
    const across = wrapSteps(height, SIZE);
    expect(across.x).toBeLessThanOrEqual(inside.x);
    expect(across.y).toBeLessThanOrEqual(inside.y);
  });
});
