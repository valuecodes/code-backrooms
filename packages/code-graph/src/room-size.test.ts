import { GRID, ROOM_SIZE_CLASSES } from "@repo/world-generator/config";
import { describe, expect, it } from "vitest";

import { hubDimensions, roomDimensions } from "./room-size";

const onGrid = (value: number): boolean =>
  Math.abs(value / GRID - Math.round(value / GRID)) < 1e-9;

describe("roomDimensions", () => {
  it("maps line counts to size classes, on the grid", () => {
    const cases: readonly (readonly [number, "small" | "medium" | "large"])[] =
      [
        [1, "small"],
        [12, "small"],
        [13, "medium"],
        [40, "medium"],
        [41, "large"],
        [500, "large"],
      ];
    for (const [lines, size] of cases) {
      const { width, depth, size: actual } = roomDimensions(lines, 0);
      expect(actual, `${lines} lines`).toBe(size);
      const { min, max } = ROOM_SIZE_CLASSES[size];
      expect(width, `${lines} lines`).toBeGreaterThanOrEqual(min);
      expect(width, `${lines} lines`).toBeLessThanOrEqual(max);
      expect(depth).toBeGreaterThanOrEqual(min);
      expect(onGrid(width) && onGrid(depth)).toBe(true);
    }
  });

  it("grows the footprint until the perimeter can hold the doors", () => {
    const { width, depth } = roomDimensions(1, 6);
    expect(width + depth).toBeGreaterThanOrEqual(24);
    expect(Math.floor((2 * (width + depth)) / 8)).toBeGreaterThanOrEqual(6);
  });

  it("caps at the largest size class", () => {
    expect(roomDimensions(1, 12)).toEqual({
      width: 20,
      depth: 20,
      size: "large",
    });
  });

  it("is deterministic and monotone in degree", () => {
    expect(roomDimensions(20, 3)).toEqual(roomDimensions(20, 3));
    const small = roomDimensions(20, 1);
    const large = roomDimensions(20, 8);
    expect(large.width * large.depth).toBeGreaterThan(
      small.width * small.depth
    );
  });
});

describe("hubDimensions", () => {
  it("starts medium and grows with its doors", () => {
    expect(hubDimensions(2)).toEqual({ width: 8, depth: 8, size: "medium" });
    const busy = hubDimensions(5);
    expect(busy.width + busy.depth).toBeGreaterThanOrEqual(25);
  });
});
