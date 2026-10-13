import { createRng } from "@repo/world-generator/random";

/**
 * Seeded, periodic height fields and the PBR data maps derived from them.
 * Everything here is pure (no DOM, no three.js), so the maps are testable
 * and deterministic: the same seed draws the same surface on every machine.
 *
 * A height field is `size × size` values in [0, 1], row-major, row 0 at the
 * top of the texture. Every generator wraps modulo `size`, so the maps tile.
 * The loops run once per Canvas over a few hundred thousand texels each,
 * so they index typed arrays directly rather than call per texel.
 */

/** RGBA texels over a plain buffer, as `ImageData` takes them. */
type Rgba = Uint8ClampedArray<ArrayBuffer>;

const wrap = (index: number, size: number): number =>
  ((index % size) + size) % size;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Value noise on a lattice of `cells × cells` random values that wraps, so
 * the result is periodic in `size`. `cells` must divide `size`.
 */
const latticeNoise = (
  seed: number,
  size: number,
  cells: number
): Float32Array => {
  const rng = createRng(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) {
    lattice[i] = rng();
  }
  // Per axis: the cell before and after each texel and the blend between.
  const span = size / cells;
  const before = new Int32Array(size);
  const after = new Int32Array(size);
  const blend = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const cell = Math.floor(i / span);
    before[i] = cell % cells;
    after[i] = (cell + 1) % cells;
    blend[i] = smoothstep(i / span - cell);
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const row0 = (before[y] ?? 0) * cells;
    const row1 = (after[y] ?? 0) * cells;
    const ty = blend[y] ?? 0;
    const base = y * size;
    for (let x = 0; x < size; x += 1) {
      const x0 = before[x] ?? 0;
      const x1 = after[x] ?? 0;
      const tx = blend[x] ?? 0;
      const a = lattice[row0 + x0] ?? 0;
      const b = lattice[row0 + x1] ?? 0;
      const c = lattice[row1 + x0] ?? 0;
      const d = lattice[row1 + x1] ?? 0;
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      out[base + x] = top + (bottom - top) * ty;
    }
  }
  return out;
};

type FbmOptions = {
  readonly octaves: number;
  /** Lattice cells per axis of the first octave; doubles each octave. */
  readonly cells: number;
  readonly gain?: number;
};

/**
 * Fractal sum of periodic value noise, normalised to [0, 1]. No octave is
 * finer than two texels per cell: that would only add per-texel noise,
 * which the surfaces add themselves where they want it. So a small field
 * (a test's) gets coarser noise than a large one, never none.
 */
const fbm = (
  seed: number,
  size: number,
  { octaves, cells, gain = 0.5 }: FbmOptions
): Float32Array => {
  const out = new Float32Array(size * size);
  const first = Math.min(cells, size / 2);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const octaveCells = first * 2 ** octave;
    if (octaveCells * 2 > size) {
      break;
    }
    const noise = latticeNoise(seed + octave * 7919, size, octaveCells);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = (out[i] ?? 0) + (noise[i] ?? 0) * amplitude;
    }
    total += amplitude;
    amplitude *= gain;
  }
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (out[i] ?? 0) / total;
  }
  return out;
};

/** One axis of a wrapping box blur with a running sum: O(n), any radius. */
const blurAxis = (
  input: Float32Array,
  size: number,
  radius: number,
  stepX: number,
  stepY: number
): Float32Array => {
  const out = new Float32Array(size * size);
  const window = 2 * radius + 1;
  for (let line = 0; line < size; line += 1) {
    const start = line * stepY;
    let sum = 0;
    for (let d = -radius; d <= radius; d += 1) {
      sum += input[start + wrap(d, size) * stepX] ?? 0;
    }
    for (let i = 0; i < size; i += 1) {
      out[start + i * stepX] = sum / window;
      sum -= input[start + wrap(i - radius, size) * stepX] ?? 0;
      sum += input[start + wrap(i + radius + 1, size) * stepX] ?? 0;
    }
  }
  return out;
};

/** Box blur of radius `radius`, wrapping, two separable passes. */
const blur = (
  height: Float32Array,
  size: number,
  radius: number
): Float32Array =>
  blurAxis(blurAxis(height, size, radius, 1, size), size, radius, size, 1);

/**
 * Tangent-space normal map from a height field: central differences that
 * wrap at the edges. Flat is (128, 128, 255). The texture is uploaded with
 * row 0 at v = 1, so a slope down the rows is a slope down v, which is why
 * G follows +dh/drow.
 */
const heightToNormal = (
  height: Float32Array,
  size: number,
  strength: number
): Rgba => {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    const rowUp = wrap(y - 1, size) * size;
    const rowDown = wrap(y + 1, size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = height[row + wrap(x - 1, size)] ?? 0;
      const right = height[row + wrap(x + 1, size)] ?? 0;
      const up = height[rowUp + x] ?? 0;
      const down = height[rowDown + x] ?? 0;
      const dx = ((right - left) / 2) * strength;
      const dy = ((down - up) / 2) * strength;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + x) * 4;
      out[i] = 128 + (-dx / length) * 127;
      out[i + 1] = 128 + (dy / length) * 127;
      out[i + 2] = 128 + (1 / length) * 127;
      out[i + 3] = 255;
    }
  }
  return out;
};

type OrmOptions = {
  /** Mid roughness, in [0, 1]. */
  readonly roughness: number;
  /** How far the roughness swings around the mid: valleys rougher, peaks smoother. */
  readonly spread: number;
  /** How dark a cavity gets; 0 for no occlusion. */
  readonly cavity: number;
};

/**
 * One RGBA texture in three's glTF layout: R occlusion, G roughness, B 255
 * (no metalness map). Occlusion is a cheap cavity term, how far a texel
 * lies below its blurred surroundings.
 */
const heightToOrm = (
  height: Float32Array,
  size: number,
  { roughness, spread, cavity }: OrmOptions
): Rgba => {
  const mean = blur(height, size, Math.max(1, Math.round(size / 128)));
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < height.length; i += 1) {
    const h = height[i] ?? 0;
    const below = Math.max(0, (mean[i] ?? 0) - h);
    const occlusion = clamp01(1 - below * cavity);
    const rough = clamp01(roughness + spread * (1 - 2 * h));
    out[i * 4] = occlusion * 255;
    out[i * 4 + 1] = rough * 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = 255;
  }
  return out;
};

/** Averages 2 × 2 values, halving a height field's size. */
const halveHeight = (height: Float32Array, size: number): Float32Array => {
  const half = size / 2;
  const out = new Float32Array(half * half);
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const row = 2 * y * size + 2 * x;
      out[y * half + x] =
        ((height[row] ?? 0) +
          (height[row + 1] ?? 0) +
          (height[row + size] ?? 0) +
          (height[row + size + 1] ?? 0)) /
        4;
    }
  }
  return out;
};

/** Averages 2 × 2 texels, halving an RGBA map's size. */
const downsample = (rgba: Rgba, size: number): Rgba => {
  const half = size / 2;
  const out = new Uint8ClampedArray(half * half * 4);
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const a = rgba[(2 * y * size + 2 * x) * 4 + c] ?? 0;
        const b = rgba[(2 * y * size + 2 * x + 1) * 4 + c] ?? 0;
        const d = rgba[((2 * y + 1) * size + 2 * x) * 4 + c] ?? 0;
        const e = rgba[((2 * y + 1) * size + 2 * x + 1) * 4 + c] ?? 0;
        out[(y * half + x) * 4 + c] = (a + b + d + e) / 4;
      }
    }
  }
  return out;
};

/** Mustard wallpaper: embossed stripes, the diamond motif and paper grain. */
const wallpaperHeight = (size: number): Float32Array => {
  const grain = fbm(11, size, { octaves: 2, cells: 128 });
  const stripes = 16;
  const diamonds = 4;
  const cell = size / diamonds;
  // Per axis: the soft-edged stripe, as flocked paper, and each texel's
  // distance from its diamond cell's centre, scaled to the motif's shape.
  const stripe = new Float32Array(size);
  const across = new Float32Array(size);
  const along = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const phase = ((i * stripes) / size) % 1;
    stripe[i] = phase < 0.45 ? smoothstep(Math.min(1, phase / 0.08)) : 0;
    const offset = Math.abs((i % cell) / cell - 0.5);
    across[i] = offset / 0.45;
    along[i] = offset / 0.7;
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const dy = along[y] ?? 0;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      // The diamond outline: an L1 ring around each cell's centre.
      const ring = Math.abs((across[x] ?? 0) + dy - 0.5);
      const diamond = ring < 0.04 ? 1 - ring / 0.04 : 0;
      const i = row + x;
      out[i] = clamp01(
        0.45 +
          0.12 * (stripe[x] ?? 0) +
          0.15 * diamond +
          0.1 * ((grain[i] ?? 0) - 0.5)
      );
    }
  }
  return out;
};

/** Low-pile carpet: dense fibre noise over a looser weave. */
const carpetHeight = (size: number): Float32Array => {
  const fibres = fbm(23, size, { octaves: 4, cells: 32, gain: 0.6 });
  const weave = fbm(29, size, { octaves: 2, cells: 8 });
  const rng = createRng(31);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = clamp01(
      0.35 + 0.5 * (fibres[i] ?? 0) + 0.1 * (weave[i] ?? 0) + 0.12 * rng()
    );
  }
  return out;
};

/** Drop-ceiling tile: fissures, pin holes and the seam around the edge. */
const ceilingHeight = (size: number): Float32Array => {
  const texture = fbm(41, size, { octaves: 3, cells: 16 });
  const fissures = fbm(43, size, { octaves: 3, cells: 24, gain: 0.55 });
  const out = new Float32Array(size * size);
  const seam = Math.max(2, Math.round(size / 170));
  for (let y = 0; y < size; y += 1) {
    const edgeRow = y < seam || y >= size - seam;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const i = row + x;
      if (edgeRow || x < seam || x >= size - seam) {
        out[i] = 0.2;
        continue;
      }
      // Sparse, shallow fissures: the tops of the finer noise only.
      const fissure = (fissures[i] ?? 0) > 0.7 ? 0.12 : 0;
      out[i] = clamp01(0.75 + 0.05 * ((texture[i] ?? 0) - 0.5) - fissure);
    }
  }
  // Pin holes, placed modulo the size so they tile.
  const rng = createRng(47);
  const holes = Math.round((size * size) / 1500);
  for (let n = 0; n < holes; n += 1) {
    const hx = Math.floor(rng() * size);
    const hy = Math.floor(rng() * size);
    const r = 1 + Math.floor(rng() * 2);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy <= r * r) {
          const i = wrap(hy + dy, size) * size + wrap(hx + dx, size);
          out[i] = Math.min(out[i] ?? 0, 0.35);
        }
      }
    }
  }
  return out;
};

export {
  carpetHeight,
  ceilingHeight,
  downsample,
  fbm,
  halveHeight,
  heightToNormal,
  heightToOrm,
  wallpaperHeight,
};
export type { Rgba };
