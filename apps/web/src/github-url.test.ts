import { describe, expect, it } from "vitest";

import { gitHubPath, isRef, parseGitHubUrl } from "./github-url";

describe("parseGitHubUrl", () => {
  it.each([
    "https://github.com/pmndrs/zustand",
    "http://github.com/pmndrs/zustand/",
    "github.com/pmndrs/zustand",
    "https://www.github.com/pmndrs/zustand.git",
    "  pmndrs/zustand  ",
    "https://github.com/pmndrs/zustand?tab=readme#install",
  ])("reads %s as the whole repository", (input) => {
    expect(parseGitHubUrl(input)).toEqual({
      owner: "pmndrs",
      repo: "zustand",
      ref: null,
      subpath: null,
    });
  });

  it("reads a branch and a folder from a /tree/ URL", () => {
    expect(
      parseGitHubUrl(
        "https://github.com/vitejs/vite/tree/main/packages/vite/src"
      )
    ).toEqual({
      owner: "vitejs",
      repo: "vite",
      ref: "main",
      subpath: "packages/vite/src",
    });
    expect(parseGitHubUrl("o/r/tree/v1.2.3")).toEqual({
      owner: "o",
      repo: "r",
      ref: "v1.2.3",
      subpath: null,
    });
  });

  it.each([
    "",
    "pmndrs",
    "https://gitlab.com/pmndrs/zustand",
    "https://github.com.evil.com/pmndrs/zustand",
    "javascript:alert(1)",
    "pmndrs/zustand/blob/main/src/index.ts",
    "pmndrs/zustand/tree",
    "pmndrs/zustand/tree/../x",
    "pmndrs/zustand/tree/main/../../secrets",
    "pmndrs/zustand/tree/main/a%2Fb",
    "-pmndrs/zustand",
    "pmn--drs/zustand",
    "pmndrs/..",
    "pmndrs/zust and",
  ])("refuses %j", (input) => {
    expect(parseGitHubUrl(input)).toBeNull();
  });
});

describe("isRef", () => {
  it("takes branch, tag and commit names and HEAD", () => {
    for (const ref of ["main", "HEAD", "v1.0.0", "release_2", "a1b2c3d"]) {
      expect(isRef(ref)).toBe(true);
    }
  });

  it("refuses names that could leave the path or are not refs", () => {
    for (const ref of ["", "..", "a..b", "-x", "x.lock", "a/b", "a?b", "a b"]) {
      expect(isRef(ref)).toBe(false);
    }
  });
});

describe("gitHubPath", () => {
  it.each([
    "pmndrs/zustand",
    "pmndrs/zustand/tree/main",
    "vitejs/vite/tree/main/packages/vite/src",
  ])("parses back to the same target: %s", (path) => {
    const target = parseGitHubUrl(path);
    expect(target === null ? null : gitHubPath(target)).toBe(path);
  });
});
