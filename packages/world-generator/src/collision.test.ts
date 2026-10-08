import type { Rect } from "@repo/types";
import { describe, expect, it } from "vitest";

import { moveWithCollisions, resolveMovement } from "./collision";

// Values here are exact in binary so "touching" is exactly touching.
const RADIUS = 0.25;
const STEP = 0.1;

/** A wall along X at z in [2, 2.25], with a 1.25 m gap from x = 0.5 to 1.75. */
const gapWall: readonly Rect[] = [
  { minX: -10, maxX: 0.5, minZ: 2, maxZ: 2.25 },
  { minX: 1.75, maxX: 10, minZ: 2, maxZ: 2.25 },
];

describe("resolveMovement", () => {
  it("stops at the wall face minus the radius", () => {
    const next = resolveMovement(
      { x: -5, z: 1.5 },
      { x: 0, z: 0.5 },
      RADIUS,
      gapWall
    );
    expect(next).toEqual({ x: -5, z: 2 - RADIUS });
  });

  it("keeps the component parallel to the wall when moving diagonally into it", () => {
    const next = resolveMovement(
      { x: -5, z: 1.5 },
      { x: 0.5, z: 0.5 },
      RADIUS,
      gapWall
    );
    expect(next).toEqual({ x: -4.5, z: 2 - RADIUS });
  });

  it("lets a footprint flush against the wall slide along it", () => {
    const flush = { x: -5, z: 2 - RADIUS };
    const next = resolveMovement(flush, { x: 0.5, z: 0 }, RADIUS, gapWall);
    expect(next).toEqual({ x: -4.5, z: 2 - RADIUS });
  });

  it("clamps to the far face when approaching from the other side", () => {
    const next = resolveMovement(
      { x: -5, z: 2.75 },
      { x: 0, z: -0.5 },
      RADIUS,
      gapWall
    );
    expect(next).toEqual({ x: -5, z: 2.25 + RADIUS });
  });

  it("leaves the position alone when nothing is hit", () => {
    const next = resolveMovement(
      { x: 0, z: 0 },
      { x: 0.25, z: -0.25 },
      RADIUS,
      gapWall
    );
    expect(next).toEqual({ x: 0.25, z: -0.25 });
  });
});

describe("moveWithCollisions", () => {
  it("does not tunnel through a thin wall on a large step", () => {
    const next = moveWithCollisions(
      { x: -5, z: 0 },
      { x: 0, z: 10 },
      RADIUS,
      gapWall,
      STEP
    );
    expect(next.x).toBe(-5);
    expect(next.z).toBeCloseTo(2 - RADIUS);
  });

  it("walks through the gap", () => {
    const next = moveWithCollisions(
      { x: 1.125, z: 0 },
      { x: 0, z: 4 },
      RADIUS,
      gapWall,
      STEP
    );
    expect(next.x).toBe(1.125);
    expect(next.z).toBeCloseTo(4);
  });

  it("walks through when exactly touching the jamb", () => {
    const next = moveWithCollisions(
      { x: 1.5, z: 0 },
      { x: 0, z: 4 },
      RADIUS,
      gapWall,
      STEP
    );
    expect(next.x).toBe(1.5);
    expect(next.z).toBeCloseTo(4);
  });

  it("is blocked when overlapping the jamb", () => {
    const next = moveWithCollisions(
      { x: 1.5625, z: 0 },
      { x: 0, z: 4 },
      RADIUS,
      gapWall,
      STEP
    );
    expect(next.x).toBe(1.5625);
    expect(next.z).toBeCloseTo(2 - RADIUS);
  });

  it("returns the same position for a zero delta", () => {
    const position = { x: 1, z: 1 };
    expect(
      moveWithCollisions(position, { x: 0, z: 0 }, RADIUS, gapWall, STEP)
    ).toBe(position);
  });

  it("reaches the destination when nothing is in the way", () => {
    const next = moveWithCollisions(
      { x: 0, z: 0 },
      { x: 0.3, z: -0.4 },
      RADIUS,
      gapWall,
      STEP
    );
    expect(next.x).toBeCloseTo(0.3);
    expect(next.z).toBeCloseTo(-0.4);
  });
});
