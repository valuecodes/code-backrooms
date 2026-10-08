import type { Point, Rect } from "@repo/types";

/** Strict, so a footprint flush against a wall is touching, not colliding. */
const overlaps = (
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number
): boolean => aMin < bMax && aMax > bMin;

/**
 * Moves a square footprint of half-extent `radius` by `delta`, one axis at a
 * time, clamping to the face of any collider it would enter. Resolving the axes
 * separately is what makes the player slide along walls instead of sticking.
 */
const resolveMovement = (
  position: Point,
  delta: Point,
  radius: number,
  colliders: readonly Rect[]
): Point => {
  let x = position.x + delta.x;
  for (const box of colliders) {
    if (
      overlaps(position.z - radius, position.z + radius, box.minZ, box.maxZ) &&
      overlaps(x - radius, x + radius, box.minX, box.maxX)
    ) {
      x = delta.x > 0 ? box.minX - radius : box.maxX + radius;
    }
  }
  let z = position.z + delta.z;
  for (const box of colliders) {
    if (
      overlaps(x - radius, x + radius, box.minX, box.maxX) &&
      overlaps(z - radius, z + radius, box.minZ, box.maxZ)
    ) {
      z = delta.z > 0 ? box.minZ - radius : box.maxZ + radius;
    }
  }
  return { x, z };
};

/** Splits `delta` into steps no longer than `maxStep` so fast moves cannot skip a wall. */
const moveWithCollisions = (
  position: Point,
  delta: Point,
  radius: number,
  colliders: readonly Rect[],
  maxStep: number
): Point => {
  const distance = Math.hypot(delta.x, delta.z);
  if (distance === 0) {
    return position;
  }
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const step = { x: delta.x / steps, z: delta.z / steps };
  let current = position;
  for (let i = 0; i < steps; i += 1) {
    current = resolveMovement(current, step, radius, colliders);
  }
  return current;
};

export { moveWithCollisions, resolveMovement };
