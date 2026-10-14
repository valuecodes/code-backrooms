import type { AreaWorld } from "@repo/types";

// The map page's words, apart from the page so tests need no URL to load.

type HeaderOptions = {
  /** The example, the preset, or `random`. */
  readonly name: string;
  readonly seed: number;
  readonly world: AreaWorld;
};

/** `repo · seed 7 · 3/9 areas · 1 failed`. */
const mapHeader = ({ name, seed, world }: HeaderOptions): string => {
  // An unloaded area was generated: it counts as built.
  const built = world.areas.length + world.unloaded.length;
  const failed = world.failed.length;
  const total = built + world.pending.length + failed;
  return `${name} · seed ${seed} · ${built}/${total} areas · ${failed} failed`;
};

/** The downloaded map's file name. */
const svgFileName = (name: string, seed: number): string =>
  `code-backrooms-${name}-${seed}.svg`;

export { mapHeader, svgFileName };
