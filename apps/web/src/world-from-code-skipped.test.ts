import { describe, expect, it } from "vitest";

import { codeGraphOf } from "./world-from-code";

// A repository brought by the user may hold files that do not parse: with
// `tolerant` they are left out and listed, unless nothing is left to build a
// world from. Bundled examples stay strict.

const tolerant = { tolerant: true };
const mixed = [
  { path: "good.ts", source: "function good() {}" },
  { path: "bad.ts", source: "function (" },
];

describe("codeGraphOf with files that do not parse", () => {
  it("is an error by default, as for a bundled example", () => {
    expect(codeGraphOf(mixed).error).toMatch(/bad\.ts: /);
  });

  it("skips a file that does not parse and lists it when tolerant", () => {
    const result = codeGraphOf(mixed, tolerant);
    expect(result.error).toBeNull();
    if (result.codeGraph === null) {
      throw new Error(result.error);
    }
    expect(result.skipped).toEqual(["bad.ts"]);
    expect(result.codeGraph.modules.map((module) => module.id)).toEqual([
      "good.ts",
    ]);
  });

  it("is an error when no source parses, naming the first paths", () => {
    const bad = ["a.ts", "b.ts", "c.ts", "d.ts"].map((path) => ({
      path,
      source: "function (",
    }));
    expect(codeGraphOf(bad.slice(0, 2), tolerant).error).toBe(
      "none of the 2 source files could be parsed: a.ts, b.ts"
    );
    expect(
      codeGraphOf([...bad, { path: "package.json", source: "{}" }], tolerant)
        .error
    ).toBe("none of the 4 source files could be parsed: a.ts, b.ts, c.ts…");
  });

  it("is an error when there are no sources", () => {
    expect(codeGraphOf([]).error).toBe(
      "no JavaScript or TypeScript sources found"
    );
    expect(
      codeGraphOf([{ path: "package.json", source: '{ "name": "x" }' }]).error
    ).toBe("no JavaScript or TypeScript sources found");
  });
});
