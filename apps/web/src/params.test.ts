import { describe, expect, it } from "vitest";

import { parseWorldParams, withSeed } from "./params";

describe("parseWorldParams", () => {
  it("falls back to defaults for an empty query", () => {
    expect(parseWorldParams("")).toEqual({ seed: 1, rooms: 15, preset: null });
  });

  it("reads seed, rooms and a known preset", () => {
    expect(parseWorldParams("?seed=42&rooms=20&graph=hub")).toEqual({
      seed: 42,
      rooms: 20,
      preset: "hub",
    });
  });

  it("clamps rooms and ignores junk", () => {
    expect(parseWorldParams("?rooms=9999&seed=abc&graph=nope")).toEqual({
      seed: 1,
      rooms: 40,
      preset: null,
    });
    expect(parseWorldParams("?rooms=-5")).toMatchObject({ rooms: 1 });
  });

  it("does not treat prototype keys as presets", () => {
    expect(parseWorldParams("?graph=constructor").preset).toBeNull();
  });
});

describe("withSeed", () => {
  it("replaces the seed and keeps other params", () => {
    expect(withSeed("?graph=hub&seed=3", 4)).toBe("?graph=hub&seed=4");
    expect(withSeed("", 9)).toBe("?seed=9");
  });
});
