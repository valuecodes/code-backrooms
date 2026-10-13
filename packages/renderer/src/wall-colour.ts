import type { WallSegment } from "@repo/types";
import { hashString } from "@repo/world-generator/random";

import { lintelTint, wallTint } from "./lane-tint";
import type { Rgb } from "./lane-tint";

/**
 * Each room's wallpaper a shade lighter or darker (within 4 %), fixed by its
 * id, so neighbouring rooms are not quite the same.
 */
const wallShade = (roomId: string): number =>
  1 + ((hashString(roomId) % 81) - 40) / 1000;

/**
 * A wall segment's vertex colour: walls take their lane's wash, lintels the
 * full colour of their door's lane, both in the room's own shade. Not
 * clamped at 1: plain walls are white, and vertex colours just above 1
 * brighten the wallpaper texture, so lighter rooms differ as darker ones do.
 */
const segmentColour = (segment: WallSegment, roomId: string): Rgb => {
  const shade = wallShade(roomId);
  const [r, g, b] =
    segment.kind === "lintel"
      ? lintelTint(segment.lane)
      : wallTint(segment.lane);
  return [r * shade, g * shade, b * shade];
};

export { segmentColour };
