import { describe, expect, it } from "vitest";

import { analyse, analysisFailed, respond } from "./analyse";
import { examples } from "./examples";
import { sourceSeedOf } from "./world-from-code";

/** One module that parses and one that does not. */
const mixed = [
  { path: "src/good.ts", source: "export function ok() { return 1; }" },
  { path: "src/broken.ts", source: "function (" },
];

describe("analyse", () => {
  it("parses, links and seeds an example", () => {
    const { code, areaLinks, sourceSeed } = analyse(examples.repo, {
      tolerant: false,
    });
    expect(code.codeGraph).not.toBeNull();
    expect(areaLinks.length).toBeGreaterThan(0);
    expect(sourceSeed).toBe(sourceSeedOf(examples.repo));
  });

  // The worker hands its result to the page by structured clone.
  it("survives a structured clone", () => {
    for (const analysis of [
      analyse(examples.repo, { tolerant: false }),
      analyse(mixed, { tolerant: true }),
    ]) {
      expect(structuredClone(analysis)).toEqual(analysis);
    }
  });
});

describe("respond", () => {
  it("analyses tolerantly, listing the files left out", () => {
    const response = respond(mixed);
    expect("analysis" in response).toBe(true);
    const code = "analysis" in response ? response.analysis.code : null;
    expect(code?.error === null && code.skipped).toEqual(["src/broken.ts"]);
  });

  it("turns a repository with no sources into an error, not a throw", () => {
    const response = respond([{ path: "package.json", source: "{}" }]);
    const code = "analysis" in response ? response.analysis.code : null;
    expect(code?.codeGraph).toBeNull();
    expect(code?.error).toBe("no JavaScript or TypeScript sources found");
  });
});

describe("analysisFailed", () => {
  it("is an error with no graph, links or seed", () => {
    expect(analysisFailed("boom")).toEqual({
      code: { codeGraph: null, error: "boom" },
      areaLinks: [],
      sourceSeed: null,
    });
  });
});
