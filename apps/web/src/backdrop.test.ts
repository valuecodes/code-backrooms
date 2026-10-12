import { describe, expect, it } from "vitest";

import { backdropAllowed, driftPose } from "./backdrop";

const start = { position: { x: 0, z: 0 }, facing: { x: 0, z: 20 } };

describe("backdropAllowed", () => {
  it("runs only with WebGL2", () => {
    expect(backdropAllowed({ webgl2: true })).toBe(true);
    expect(backdropAllowed({ webgl2: false })).toBe(false);
  });
});

describe("driftPose", () => {
  it("starts at the start and looks toward the doorway", () => {
    const pose = driftPose(start, 0);
    expect(pose.position).toEqual({ x: 0, z: 0 });
    expect(pose.facing.x).toBeCloseTo(0);
    expect(pose.facing.z).toBeGreaterThan(0);
  });

  it("walks at most five metres toward the doorway, then back", () => {
    const furthest = driftPose(start, 18);
    expect(furthest.position.x).toBeCloseTo(0);
    expect(furthest.position.z).toBeCloseTo(5);
    expect(driftPose(start, 36).position.z).toBeCloseTo(0);
  });

  it("stops well short of a near doorway", () => {
    const near = { position: { x: 2, z: 2 }, facing: { x: 6, z: 2 } };
    expect(driftPose(near, 18).position.x).toBeCloseTo(3.8);
  });

  it("never moves away from the doorway or overshoots it", () => {
    for (let seconds = 0; seconds < 72; seconds += 0.7) {
      const { position } = driftPose(start, seconds);
      expect(position.z).toBeGreaterThanOrEqual(0);
      expect(position.z).toBeLessThanOrEqual(5 + 1e-9);
    }
  });

  it("stays put when it already stands on its facing point", () => {
    const still = { position: { x: 1, z: 1 }, facing: { x: 1, z: 1 } };
    expect(driftPose(still, 9)).toBe(still);
  });
});
