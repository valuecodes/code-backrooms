import { isPresetName } from "@repo/world-generator/presets";
import type { PresetName } from "@repo/world-generator/presets";

import { isExampleName } from "~/examples";
import type { ExampleName } from "~/examples";

/** What the URL asks the generator for. */
type WorldParams = {
  readonly seed: number;
  readonly rooms: number;
  readonly preset: PresetName | null;
  /** A bundled program to generate rooms from; wins over `preset`. */
  readonly code: ExampleName | null;
};

const DEFAULT_SEED = 1;
const DEFAULT_ROOMS = 15;
const MIN_ROOMS = 1;
/** Generation runs on the main thread; beyond this it would stall the tab. */
const MAX_ROOMS = 40;

/** Whole decimal integers only: `parseInt` alone would accept `20junk` or `1.5`. */
const INTEGER = /^-?\d+$/;

const parseInteger = (
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number => {
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
    seed: parseInteger(params.get("seed"), DEFAULT_SEED, 0, 2 ** 31 - 1),
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

/** The URL for the same world with another seed, keeping the rest. */
const withSeed = (search: string, seed: number): string => {
  const params = new URLSearchParams(search);
  params.set("seed", String(seed));
  return `?${params.toString()}`;
};

export { parseWorldParams, withSeed };
