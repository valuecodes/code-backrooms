import { describe, expect, it } from "vitest";

import {
  MAX_FILE_BYTES,
  MAX_KEPT_BYTES,
  MAX_KEPT_FILES,
  selectSources,
} from "./source-filter";
import type { FileEntry } from "./source-filter";

const entries = (...paths: readonly string[]): FileEntry[] =>
  paths.map((path) => ({ path, size: 10 }));

const keptPaths = (...paths: readonly string[]) =>
  selectSources(entries(...paths)).kept.map((entry) => entry.path);

describe("selectSources", () => {
  it("strips a GitHub zip's repo-main/ root", () => {
    expect(
      keptPaths(
        "repo-main/",
        "repo-main/package.json",
        "repo-main/src/",
        "repo-main/src/index.ts"
      )
    ).toEqual(["package.json", "src/index.ts"]);
  });

  it("still strips the root beside a top-level .DS_Store and __MACOSX/ tree", () => {
    expect(
      keptPaths(
        ".DS_Store",
        "__MACOSX/repo-main/src/._index.ts",
        "repo-main/src/index.ts",
        "repo-main/src/.DS_Store"
      )
    ).toEqual(["src/index.ts"]);
  });

  it("still strips the root beside a top-level node_modules/ or .git/", () => {
    expect(
      keptPaths(
        "node_modules/x/index.js",
        ".git/hooks/pre-commit.js",
        "repo-main/src/index.ts"
      )
    ).toEqual(["src/index.ts"]);
  });

  it("strips a folder pick's folder name", () => {
    expect(keptPaths("my-app/src/main.tsx", "my-app/tsconfig.json")).toEqual([
      "src/main.tsx",
      "tsconfig.json",
    ]);
  });

  it("detects the root over all entries when the folder itself is ignored", () => {
    expect(keptPaths("out/src/a.ts", "out/b.ts")).toEqual(["b.ts", "src/a.ts"]);
  });

  it("keeps nothing stripped when the files share no root", () => {
    expect(keptPaths("a/x.ts", "b/y.ts", "index.ts")).toEqual([
      "a/x.ts",
      "b/y.ts",
      "index.ts",
    ]);
    expect(keptPaths("src/index.ts")).toEqual(["index.ts"]);
  });

  it("keeps sources and package.json/tsconfig manifests, drops other JSON and files", () => {
    expect(
      keptPaths(
        "r/a.ts",
        "r/b.tsx",
        "r/c.mts",
        "r/d.cts",
        "r/e.js",
        "r/f.jsx",
        "r/g.mjs",
        "r/h.cjs",
        "r/package.json",
        "r/tsconfig.build.json",
        "r/data.json",
        "r/README.md",
        "r/style.css",
        "r/.prettierrc.js"
      )
    ).toEqual([
      ".prettierrc.js",
      "a.ts",
      "b.tsx",
      "c.mts",
      "d.cts",
      "e.js",
      "f.jsx",
      "g.mjs",
      "h.cjs",
      "package.json",
      "tsconfig.build.json",
    ]);
  });

  it("drops ignored directories, dot-directories and .. segments", () => {
    expect(
      keptPaths(
        "r/src/a.ts",
        "r/node_modules/x/index.js",
        "r/packages/p/dist/index.js",
        "r/build/a.js",
        "r/out/a.js",
        "r/coverage/a.js",
        "r/src/generated/a.ts",
        "r/vendor/a.js",
        "r/src/__tests__/a.ts",
        "r/src/__mocks__/a.ts",
        "r/src/__snapshots__/a.ts",
        "r/.next/a.js",
        "r/.github/a.js",
        "r/../escape.ts"
      )
    ).toEqual(["src/a.ts"]);
  });

  it("drops test, spec, declaration and minified files", () => {
    expect(
      keptPaths(
        "r/a.ts",
        "r/a.test.ts",
        "r/a.spec.tsx",
        "r/a.d.ts",
        "r/a.d.mts",
        "r/a.d.cts",
        "r/vendor.min.js"
      )
    ).toEqual(["a.ts"]);
  });

  it("normalises Windows separators and keeps the first of a repeated path", () => {
    const { kept } = selectSources([
      { path: "repo\\src\\a.ts", size: 1 },
      { path: "repo/src/a.ts", size: 2 },
      { path: "./repo/src/b.ts", size: 3 },
    ]);
    expect(kept).toEqual([
      { path: "src/a.ts", size: 1, original: "repo\\src\\a.ts" },
      { path: "src/b.ts", size: 3, original: "./repo/src/b.ts" },
    ]);
  });

  it("skips and counts a file over 256 KB, and a repeat of it", () => {
    const selection = selectSources([
      { path: "r/big.ts", size: MAX_FILE_BYTES + 1 },
      { path: "r\\big.ts", size: 1 },
      { path: "r/edge.ts", size: MAX_FILE_BYTES },
    ]);
    expect(selection.kept.map((entry) => entry.path)).toEqual(["edge.ts"]);
    expect(selection.skipped).toBe(1);
    expect(selection.fatal).toBeNull();
  });

  it("is fatal for a manifest-only archive", () => {
    expect(selectSources(entries("r/package.json", "r/tsconfig.json"))).toEqual(
      {
        kept: [],
        skipped: 0,
        fatal: "no JavaScript or TypeScript sources found",
      }
    );
    expect(selectSources([]).fatal).toBe(
      "no JavaScript or TypeScript sources found"
    );
  });

  it("is fatal over the file count, naming the count", () => {
    const many = Array.from(
      { length: MAX_KEPT_FILES + 1 },
      (_, index) => `r/f${index}.ts`
    );
    const selection = selectSources(entries(...many));
    expect(selection.kept).toEqual([]);
    expect(selection.fatal).toBe(
      "401 files to load, more than the 400 allowed: load a subfolder"
    );
    expect(selectSources(entries(...many.slice(1))).fatal).toBeNull();
  });

  it("is fatal over the byte cap, naming the size", () => {
    const count = Math.ceil(MAX_KEPT_BYTES / MAX_FILE_BYTES) + 1;
    const heavy = Array.from({ length: count }, (_, index) => ({
      path: `r/f${index}.ts`,
      size: MAX_FILE_BYTES,
    }));
    expect(selectSources(heavy).fatal).toBe(
      "8.3 MB of sources, more than the 8.0 MB allowed: load a subfolder"
    );
  });

  it("returns kept files in code-unit path order with their original names", () => {
    const { kept } = selectSources(
      entries("r/src/b.ts", "r/src/B.ts", "r/src/a.ts", "r/package.json")
    );
    expect(kept.map((entry) => [entry.path, entry.original])).toEqual([
      ["package.json", "r/package.json"],
      ["src/B.ts", "r/src/B.ts"],
      ["src/a.ts", "r/src/a.ts"],
      ["src/b.ts", "r/src/b.ts"],
    ]);
  });
});
