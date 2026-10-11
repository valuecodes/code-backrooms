import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import {
  initialSeed,
  MAX_SEED,
  nextSeed,
  parseWorldParams,
  withSeed,
} from "./params";
import { sourceSeedOf } from "./world-from-code";

describe("parseWorldParams", () => {
  it("falls back to defaults for an empty query", () => {
    expect(parseWorldParams("")).toEqual({
      seed: null,
      rooms: 15,
      preset: null,
      code: null,
      eager: false,
      view: "world",
    });
  });

  it("reads seed, rooms, a known preset and a known example", () => {
    expect(
      parseWorldParams("?seed=42&rooms=20&graph=hub&code=demo&eager=1")
    ).toEqual({
      seed: 42,
      rooms: 20,
      preset: "hub",
      code: "demo",
      eager: true,
      view: "world",
    });
  });

  it("reads ?code=self, the repository itself", () => {
    expect(parseWorldParams("?code=self").code).toBe("self");
  });

  it("reads ?view=map", () => {
    expect(parseWorldParams("?code=repo&view=map").view).toBe("map");
  });

  it("falls back to the world view for an unknown view", () => {
    expect(parseWorldParams("?view=MAP").view).toBe("world");
    expect(parseWorldParams("?view=3d").view).toBe("world");
    expect(parseWorldParams("?view").view).toBe("world");
  });

  it("is eager only for eager=1", () => {
    expect(parseWorldParams("?eager=0").eager).toBe(false);
    expect(parseWorldParams("?eager=true").eager).toBe(false);
    expect(parseWorldParams("?eager").eager).toBe(false);
  });

  it("clamps rooms and ignores junk", () => {
    expect(
      parseWorldParams("?rooms=9999&seed=abc&graph=nope&code=nope")
    ).toEqual({
      seed: null,
      rooms: 40,
      preset: null,
      code: null,
      eager: false,
      view: "world",
    });
    expect(parseWorldParams("?rooms=-5")).toMatchObject({ rooms: 1 });
    expect(parseWorldParams("?rooms=20junk&seed=1.5")).toMatchObject({
      rooms: 15,
      seed: null,
    });
    expect(parseWorldParams("?seed=9e3")).toMatchObject({ seed: null });
    expect(parseWorldParams("?seed=99999999999")).toMatchObject({
      seed: MAX_SEED,
    });
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

describe("seeds", () => {
  it("starts from the URL, else the source, else 1", () => {
    expect(initialSeed(parseWorldParams("?seed=4"), 99)).toBe(4);
    expect(initialSeed(parseWorldParams("?seed=0"), 99)).toBe(0);
    expect(initialSeed(parseWorldParams("?code=demo"), 99)).toBe(99);
    expect(initialSeed(parseWorldParams(""), null)).toBe(1);
  });

  it("wraps N at the largest seed a URL carries", () => {
    expect(nextSeed(5)).toBe(6);
    expect(nextSeed(MAX_SEED)).toBe(0);
    expect(parseWorldParams(withSeed("", nextSeed(MAX_SEED - 1))).seed).toBe(
      MAX_SEED
    );
  });

  it("gives a code world a source seed a shared URL reloads unchanged", () => {
    for (const name of ["demo", "loops", "switches"] as const) {
      const seed = sourceSeedOf(examples[name]);
      expect(seed).toBe(sourceSeedOf(examples[name]));
      expect(seed).toBeLessThanOrEqual(MAX_SEED);
      expect(parseWorldParams(withSeed(`?code=${name}`, seed)).seed).toBe(seed);
    }
  });
});
