import type { Vec3 } from "@repo/types";
import { BoxGeometry, PlaneGeometry } from "three";
import type { BufferGeometry } from "three";

/**
 * Scales the UVs of vertices [from, to) so a texture repeats in world metres
 * instead of stretching once across the face.
 */
const scaleUvs = (
  geometry: BufferGeometry,
  from: number,
  to: number,
  u: number,
  v: number
) => {
  const uv = geometry.getAttribute("uv");
  for (let i = from; i < to; i += 1) {
    uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  }
  uv.needsUpdate = true;
};

/** A width × height plane whose texture repeats every `tile` metres. */
const tiledPlane = (
  width: number,
  height: number,
  tile: number
): PlaneGeometry => {
  const geometry = new PlaneGeometry(width, height);
  scaleUvs(
    geometry,
    0,
    geometry.getAttribute("uv").count,
    width / tile,
    height / tile
  );
  return geometry;
};

/**
 * A box whose texture repeats every `tile` metres on every face. BoxGeometry
 * lists its faces as +x, -x, +y, -y, +z, -z with four vertices each.
 */
const tiledBox = ([width, height, depth]: Vec3, tile: number): BoxGeometry => {
  const geometry = new BoxGeometry(width, height, depth);
  const faces: readonly (readonly [number, number])[] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  faces.forEach(([u, v], face) => {
    scaleUvs(geometry, face * 4, face * 4 + 4, u / tile, v / tile);
  });
  return geometry;
};

export { tiledBox, tiledPlane };
