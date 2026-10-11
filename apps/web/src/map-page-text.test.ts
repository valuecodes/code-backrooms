import { codeAreaStore } from "@repo/code-graph/module-areas";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { mapHeader, svgFileName } from "./map-page-text";
import { codeGraphOf } from "./world-from-code";

const repo = () => {
  const { codeGraph, error } = codeGraphOf(examples.repo);
  if (codeGraph === null) {
    throw new Error(`repo: ${error}`);
  }
  return codeGraph;
};

describe("mapHeader", () => {
  it("counts the areas generated, in all and failed while generating", () => {
    const { world } = codeAreaStore(repo(), 1).snapshot();
    const total = 1 + world.pending.length;
    expect(total).toBeGreaterThan(1);
    const failed = { ...world, pending: world.pending.slice(1), failed: ["x"] };
    expect(mapHeader({ name: "repo", seed: 7, world: failed })).toBe(
      `repo · seed 7 · 1/${total} areas · 1 failed`
    );
  });

  it("counts every area once all are generated", () => {
    const store = codeAreaStore(repo(), 1);
    store.ensureAll();
    const { world } = store.snapshot();
    const built = world.areas.length;
    expect(mapHeader({ name: "repo", seed: 1, world })).toBe(
      `repo · seed 1 · ${built}/${built} areas · 0 failed`
    );
  });
});

describe("svgFileName", () => {
  it("names the world and its seed", () => {
    expect(svgFileName("repo", 42)).toBe("code-backrooms-repo-42.svg");
  });
});
