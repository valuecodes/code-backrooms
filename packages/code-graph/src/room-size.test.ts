import { describe, expect, it } from "vitest";

import { hubDimensions } from "./room-size";

describe("hubDimensions", () => {
  it("starts medium and grows with its doors", () => {
    expect(hubDimensions(2)).toEqual({ width: 8, depth: 8, size: "medium" });
    const busy = hubDimensions(5);
    expect(busy.width + busy.depth).toBeGreaterThanOrEqual(25);
    expect((busy.width * 2) % 1).toBe(0);
  });

  it("caps at the largest size class", () => {
    expect(hubDimensions(40)).toEqual({ width: 20, depth: 20, size: "large" });
  });
});
