import { describe, expect, it } from "vitest";

import { parseWorldParams, withSeed } from "./params";

describe("parseWorldParams", () => {
  it("falls back to defaults for an empty query", () => {
    expect(parseWorldParams("")).toEqual({
      seed: 1,
      rooms: 15,
      preset: null,
      code: null,
    });
  });

  it("reads seed, rooms, a known preset and a known example", () => {
    expect(parseWorldParams("?seed=42&rooms=20&graph=hub&code=demo")).toEqual({
      seed: 42,
      rooms: 20,
      preset: "hub",
      code: "demo",
    });
  });

  it("clamps rooms and ignores junk", () => {
    expect(
      parseWorldParams("?rooms=9999&seed=abc&graph=nope&code=nope")
    ).toEqual({
      seed: 1,
      rooms: 40,
      preset: null,
      code: null,
    });
    expect(parseWorldParams("?rooms=-5")).toMatchObject({ rooms: 1 });
    expect(parseWorldParams("?rooms=20junk&seed=1.5")).toMatchObject({
      rooms: 15,
      seed: 1,
    });
    expect(parseWorldParams("?seed=9e3")).toMatchObject({ seed: 1 });
  });

  it("does not treat prototype keys as presets or examples", () => {
    expect(parseWorldParams("?graph=constructor").preset).toBeNull();
    expect(parseWorldParams("?code=constructor").code).toBeNull();
  });
});

describe("withSeed", () => {
  it("replaces the seed and keeps other params", () => {
    expect(withSeed("?graph=hub&seed=3", 4)).toBe("?graph=hub&seed=4");
    expect(withSeed("?code=demo", 2)).toBe("?code=demo&seed=2");
    expect(withSeed("", 9)).toBe("?seed=9");
  });
});
