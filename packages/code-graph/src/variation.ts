import { hashString } from "@repo/world-generator/random";

// Seeded proportions of a code world: they change how wide a function's
// column or a hub is, never what is connected. Each value is a pure
// function of the seed and an id, so a world is reproducible from its seed.

const COLUMN_JITTERS: readonly number[] = [0, 0.5, 1];
const HUB_RATIOS: readonly number[] = [1, 1.25, 1.5];

const pickBy = (seed: number, key: string, values: readonly number[]): number =>
  values[hashString(`${seed}:${key}`) % values.length] ?? 0;

/** Metres added to a function's column width; none without a seed. */
const columnJitter = (seed: number | null, fnId: string): number =>
  seed === null ? 0 : pickBy(seed, fnId, COLUMN_JITTERS);

/** How much wider than deep a hub starts; square without a seed. */
const hubRatio = (seed: number | null, hubId: string): number =>
  seed === null ? 1 : pickBy(seed, hubId, HUB_RATIOS);

export { columnJitter, hubRatio };
