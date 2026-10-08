import type { Vec3 } from "@repo/types";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { tiledBox } from "./tiled-geometry";

type Box = {
  readonly center: Vec3;
  readonly size: Vec3;
};

/**
 * Many boxes, one draw call. Each box is built at the origin with world-metre
 * UVs, moved to its centre, then merged; the sources are released at once and
 * the caller owns the result. Null when there is nothing to draw.
 */
const mergeBoxes = (
  boxes: readonly Box[],
  tile: number
): BufferGeometry | null => {
  if (boxes.length === 0) {
    return null;
  }
  const parts = boxes.map(({ center, size }) =>
    tiledBox(size, tile).translate(center[0], center[1], center[2])
  );
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
};

export { mergeBoxes };
export type { Box };
