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

const HEX: Record<LaneKind, string> = {
  true: "#9fbf9a",
  false: "#c28c86",
  case: "#8fa3b8",
  default: "#b0b0b0",
  loop: "#c9a85c",
  // Deeper than the body's ochre: the corridor that leads back round.
  back: "#b08a3e",
  exit: "#ffffff",
};

const PALETTE: Record<LaneKind, Rgb> = {
  true: rgb(HEX.true),
  false: rgb(HEX.false),
  case: rgb(HEX.case),
  default: rgb(HEX.default),
  loop: rgb(HEX.loop),
  back: rgb(HEX.back),
  exit: WHITE,
};

/** A lane's full colour as CSS hex, for drawing outside the scene (the map). */
const laneColour = (kind: LaneKind): string => HEX[kind];

/** Dark wood: what a frame is without a lane. The frame material is white. */
const WOOD: Rgb = rgb("#4a3620");

/** A door frame: the lane's full colour, dark wood for no lane or a loop's exit. */
const frameTint = (lane: LaneLabel | undefined): Rgb =>
  lane === undefined || lane.kind === "exit" ? WOOD : PALETTE[lane.kind];

/** A lintel over a door, wallpapered: the lane's full colour, plain for none. */
const lintelTint = (lane: LaneLabel | undefined): Rgb =>
  lane === undefined ? WHITE : PALETTE[lane.kind];

/** A wall: the lane's colour mixed halfway to white, plain for none. */
const wallTint = (lane: LaneLabel | undefined): Rgb => {
  if (lane === undefined) {
    return WHITE;
  }
  const [r, g, b] = PALETTE[lane.kind];
  return [(r + 1) / 2, (g + 1) / 2, (b + 1) / 2];
};

export { frameTint, laneColour, lintelTint, wallTint };
export type { Rgb };
