type Rng = () => number;

/** mulberry32: small, fast and deterministic for a given 32-bit seed. */
const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 1_831_565_813) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
};

/** Integer in [min, max], both inclusive. */
const nextInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

const pick = <T>(rng: Rng, items: readonly T[]): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from an empty list");
  }
  return item;
};

type Weighted<T> = {
  readonly value: T;
  readonly weight: number;
};

const pickWeighted = <T>(rng: Rng, items: readonly Weighted<T>[]): T => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) {
      return item.value;
    }
  }
  const last = items.at(-1);
  if (last === undefined) {
    throw new Error("Cannot pick from an empty list");
  }
  return last.value;
};

/** Fisher-Yates on a copy; the input is left alone. */
const shuffle = <T>(rng: Rng, items: readonly T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
};

export { createRng, nextInt, pick, pickWeighted, shuffle };
export type { Rng };
