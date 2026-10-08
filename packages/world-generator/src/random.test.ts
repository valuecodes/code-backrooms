import { describe, expect, it } from "vitest";

import { createRng, nextInt, pick, pickWeighted, shuffle } from "./random";

const sequence = (seed: number, length: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length }, () => rng());
};

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    expect(sequence(42, 20)).toEqual(sequence(42, 20));
  });

  it("differs between seeds", () => {
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20));
  });

  it("stays within [0, 1)", () => {
    for (const value of sequence(7, 1000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("helpers", () => {
  it("nextInt covers both ends of the range", () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(nextInt(rng, 2, 4));
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it("pick throws on an empty list", () => {
    expect(() => pick(createRng(1), [])).toThrow(/empty/);
  });

  it("pickWeighted never returns a zero-weight item", () => {
    const rng = createRng(9);
    for (let i = 0; i < 200; i += 1) {
      expect(
        pickWeighted(rng, [
          { value: "a", weight: 0 },
          { value: "b", weight: 1 },
        ])
      ).toBe("b");
    }
  });

  it("shuffle keeps every item and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffle(createRng(5), input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...result].sort()).toEqual(input);
  });
});
