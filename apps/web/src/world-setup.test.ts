import { beforeAll, describe, expect, it, vi } from "vitest";

import { analyse, analysisFailed } from "./analyse";
import type { Analysis } from "./analyse";
import { examples } from "./examples";
import type { SourceRequest } from "./source-request";
import type { LoadedSource } from "./use-source-files";
import { sourceSeedOf } from "./world-from-code";
import type { WorldSetup } from "./world-setup";

const NONE: SourceRequest = { kind: "none" };

/** One module that parses and one that does not. */
const mixed = [
  { path: "src/good.ts", source: "export function ok() { return 1; }" },
  { path: "src/broken.ts", source: "function (" },
];

const local = (skipped = 0): SourceRequest => ({
  kind: "local",
  label: "my-repo",
  files: mixed,
  skipped,
});

/** What the worker gives a local request. */
const tolerant = (files = mixed): Analysis =>
  analyse(files, { tolerant: true });

describe("world-setup", () => {
  // `world-setup` reads the URL as it loads: give it an empty one first.
  let worldSetup: (
    request: SourceRequest,
    analysis: Analysis | null
  ) => WorldSetup;
  let exampleAnalysis: (loaded: LoadedSource) => Analysis | null;
  let noticesOf: (
    tooLarge: number,
    unparsed: readonly string[]
  ) => readonly string[];
  beforeAll(async () => {
    vi.stubGlobal("location", { search: "" });
    ({ exampleAnalysis, noticesOf, worldSetup } =
      await import("./world-setup"));
  });

  describe("worldSetup", () => {
    it("is a random world when no example was asked for", () => {
      const setup = worldSetup(
        NONE,
        exampleAnalysis({ state: "loaded", files: null })
      );
      expect(setup.code).toBeNull();
      expect(setup.label).toBeNull();
      expect(setup.local).toBe(false);
      expect(setup.worldOptions.codeGraph).toBeNull();
      expect(setup.worldOptions.codeError).toBeNull();
      expect(setup.areaLinks).toEqual([]);
    });

    it("parses an example and seeds the world from its source", () => {
      const setup = worldSetup(
        { kind: "example", name: "repo" },
        exampleAnalysis({ state: "loaded", files: examples.repo })
      );
      expect(setup.codeGraph).not.toBeNull();
      expect(setup.label).toBe("repo");
      expect(setup.local).toBe(false);
      expect(setup.worldOptions.codeGraph).toBe(setup.codeGraph);
      expect(setup.startSeed).toBe(sourceSeedOf(examples.repo));
      expect(setup.areaLinks.length).toBeGreaterThan(0);
    });

    it("shows an example that failed to load as the world's error", () => {
      const setup = worldSetup(
        { kind: "example", name: "self" },
        exampleAnalysis({ state: "failed", error: "no chunk" })
      );
      expect(setup.codeGraph).toBeNull();
      expect(setup.worldOptions.codeError).toBe("no chunk");
    });

    it("leaves a broken file out of a local world and says so", () => {
      const setup = worldSetup(local(), tolerant());
      expect(setup.codeGraph?.modules.map((module) => module.id)).toEqual([
        "src/good.ts",
      ]);
      expect(setup.label).toBe("my-repo");
      expect(setup.local).toBe(true);
      expect(setup.startSeed).toBe(sourceSeedOf(mixed));
      expect(setup.notices).toEqual(["1 file did not parse: src/broken.ts"]);
    });

    it("keeps examples strict: the same broken file is the world's error", () => {
      const setup = worldSetup(
        { kind: "example", name: "demo" },
        exampleAnalysis({ state: "loaded", files: mixed })
      );
      expect(setup.codeGraph).toBeNull();
      expect(setup.worldOptions.codeError).not.toBeNull();
      expect(setup.notices).toEqual([]);
    });

    it("counts files skipped for their size", () => {
      const setup = worldSetup(local(2), tolerant(mixed.slice(0, 1)));
      expect(setup.notices).toEqual(["2 files over 256 KB skipped"]);
    });

    it("shows a worker that failed as the world's error", () => {
      const setup = worldSetup(local(), analysisFailed("worker crashed"));
      expect(setup.codeGraph).toBeNull();
      expect(setup.worldOptions.codeError).toBe("worker crashed");
      expect(setup.notices).toEqual([]);
    });
  });

  describe("noticesOf", () => {
    it("says nothing when nothing was left out", () => {
      expect(noticesOf(0, [])).toEqual([]);
    });

    it("names three unparsed paths, then trails off", () => {
      expect(noticesOf(1, ["a.ts", "b.ts", "c.ts", "d.ts"])).toEqual([
        "1 file over 256 KB skipped",
        "4 files did not parse: a.ts, b.ts, c.ts…",
      ]);
    });
  });
});
