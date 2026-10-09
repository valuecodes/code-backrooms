import type { LaneKind, LaneLabel } from "@repo/types";

// The colour of a lane: walls inside it take a soft wash, the frames and
// lintels of the doors into it the full colour, so the player can tell the
// true branch from the false one at a glance.

type Rgb = readonly [number, number, number];

const WHITE: Rgb = [1, 1, 1];

const rgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const PALETTE: Record<LaneKind, Rgb> = {
  true: rgb("#9fbf9a"),
  false: rgb("#c28c86"),
  case: rgb("#8fa3b8"),
  default: rgb("#b0b0b0"),
  loop: rgb("#c9a85c"),
  back: rgb("#c9a85c"),
  exit: WHITE,
};

/** The lane's full colour, white for no lane. */
const frameTint = (lane: LaneLabel | undefined): Rgb =>
  lane === undefined ? WHITE : PALETTE[lane.kind];

/** The lane's colour mixed halfway to white: a wash over wallpaper. */
const wallTint = (lane: LaneLabel | undefined): Rgb => {
  const [r, g, b] = frameTint(lane);
  return [(r + 1) / 2, (g + 1) / 2, (b + 1) / 2];
};

export { frameTint, wallTint };
export type { Rgb };
