import { describe, expect, it } from "vitest";

import { statsText } from "./stats-text";

const sample = {
  calls: 312,
  triangles: 184_321,
  geometries: 420,
  textures: 36,
  frameMs: 16.666,
};

describe("statsText", () => {
  it("names the areas alone before the first sample", () => {
    expect(statsText(null, 1)).toBe("1 area");
    expect(statsText(null, 3)).toBe("3 areas");
  });

  it("shortens large counts and rounds the frame time", () => {
    expect(statsText(sample, 9)).toBe(
      "312 draws · 184k tris · 420 geo · 36 tex · 9 areas · 16.7 ms/frame"
    );
  });

  it("writes millions with one decimal", () => {
    expect(statsText({ ...sample, triangles: 1_234_567 }, 1)).toContain(
      "1.2M tris · 420 geo · 36 tex · 1 area"
    );
  });
});
