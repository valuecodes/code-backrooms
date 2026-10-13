import { describe, expect, it } from "vitest";

import { diffuserBox, housingBoxes } from "./troffer";

const AT = { x: 2, z: -1, ceiling: 2.7 };

const extent = (
  center: readonly number[],
  size: readonly number[],
  axis: number
) => ({
  min: (center[axis] ?? 0) - (size[axis] ?? 0) / 2,
  max: (center[axis] ?? 0) + (size[axis] ?? 0) / 2,
});

describe("troffer", () => {
  it("hangs entirely below the ceiling plane", () => {
    for (const { center, size } of [...housingBoxes(AT), diffuserBox(AT)]) {
      expect(extent(center, size, 1).max).toBeLessThanOrEqual(
        AT.ceiling + 1e-9
      );
    }
  });

  it("sets the diffuser inside the rim, above its lower edge", () => {
    const { center, size } = diffuserBox(AT);
    const rims = housingBoxes(AT).slice(1);
    const rimBottom = Math.min(
      ...rims.map((rim) => extent(rim.center, rim.size, 1).min)
    );
    expect(extent(center, size, 1).min).toBeGreaterThan(rimBottom);
    const [plate] = housingBoxes(AT);
    for (const axis of [0, 2]) {
      const panel = extent(center, size, axis);
      const pan = extent(plate?.center ?? [], plate?.size ?? [], axis);
      expect(panel.min).toBeGreaterThan(pan.min);
      expect(panel.max).toBeLessThan(pan.max);
    }
  });
});
