import { isPresetName } from "@repo/world-generator/presets";
import type { PresetName } from "@repo/world-generator/presets";

import { isExampleName } from "~/examples";
import type { ExampleName } from "~/examples";

/** What the URL asks the generator for. */
type WorldParams = {
  /** Null without a valid `?seed`: code worlds then seed from their source. */
  readonly seed: number | null;
  readonly rooms: number;
  readonly preset: PresetName | null;
  /** A bundled program to generate rooms from; wins over `preset`. */
  readonly code: ExampleName | null;
};

/** Random and preset worlds without a `?seed`. */
const DEFAULT_SEED = 1;
/** The largest seed a URL carries; source hashes stay within it too. */
const MAX_SEED = 2 ** 31 - 1;
const DEFAULT_ROOMS = 15;
const MIN_ROOMS = 1;
/** Generation runs on the main thread; beyond this it would stall the tab. */
const MAX_ROOMS = 40;

/** Whole decimal integers only: `parseInt` alone would accept `20junk` or `1.5`. */
const INTEGER = /^-?\d+$/;

const parseInteger = <T>(
  value: string | null,
  fallback: T,
  min: number,
  max: number
): number | T => {
  if (value === null || !INTEGER.test(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Number.parseInt(value, 10)));
};

/**
 * `?seed=12345&rooms=15`, `?graph=branching` or `?code=demo`; anything odd
 * falls back.
 */
const parseWorldParams = (search: string): WorldParams => {
  const params = new URLSearchParams(search);
  const graph = params.get("graph");
  const code = params.get("code");
  return {
    seed: parseInteger(params.get("seed"), null, 0, MAX_SEED),
    rooms: parseInteger(
      params.get("rooms"),
      DEFAULT_ROOMS,
      MIN_ROOMS,
      MAX_ROOMS
    ),
    preset: graph !== null && isPresetName(graph) ? graph : null,
    code: code !== null && isExampleName(code) ? code : null,
  };
};

/**
 * The seed to start from: the URL's, else the source's (a code world), else
 * the default, so a code world reloads the same without a `?seed`.
 */
const initialSeed = (params: WorldParams, sourceSeed: number | null): number =>
  params.seed ?? sourceSeed ?? DEFAULT_SEED;

/** N: the next seed, wrapping so the URL never names one it would clamp. */
const nextSeed = (seed: number): number => (seed >= MAX_SEED ? 0 : seed + 1);

/** The URL for the same world with another seed, keeping the rest. */
const withSeed = (search: string, seed: number): string => {
  const params = new URLSearchParams(search);
  params.set("seed", String(seed));
  return `?${params.toString()}`;
};

export { initialSeed, MAX_SEED, nextSeed, parseWorldParams, withSeed };
