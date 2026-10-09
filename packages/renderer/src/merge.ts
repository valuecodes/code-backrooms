import type { Vec3 } from "@repo/types";
import { Float32BufferAttribute } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Rgb } from "./lane-tint";
import { tiledBox } from "./tiled-geometry";

type Box = {
  readonly center: Vec3;
  readonly size: Vec3;
  /** A vertex colour the material multiplies in; white when absent. */
  readonly color?: Rgb;
};

const WHITE: Rgb = [1, 1, 1];

/** Gives every vertex of a part the box's colour, so merged parts can differ. */
const colour = (part: BufferGeometry, color: Rgb) => {
  const count = part.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    data.set(color, index * 3);
  }
  part.setAttribute("color", new Float32BufferAttribute(data, 3));
};

/**
 * Many boxes, one draw call. Each box is built at the origin with world-metre
 * UVs, coloured, moved to its centre, then merged; the sources are released
 * at once and the caller owns the result. Null when there is nothing to draw.
 */
const mergeBoxes = (
  boxes: readonly Box[],
  tile: number
): BufferGeometry | null => {
  if (boxes.length === 0) {
    return null;
  }
  const parts = boxes.map(({ center, size, color }) => {
    const part = tiledBox(size, tile);
    colour(part, color ?? WHITE);
    return part.translate(center[0], center[1], center[2]);
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
};

export { mergeBoxes };
export type { Box };
