import { areaLinksOf } from "@repo/code-graph/area-links";
import {
  codeAreaStore,
  generateCodeWorld,
} from "@repo/code-graph/module-areas";
import { zonesOf } from "@repo/code-graph/zones";
import { checkAreas } from "@repo/world-generator/area-checks";
import { describe, expect, it } from "vitest";

import { selfFiles } from "./self-files";
import { codeGraphOf } from "./world-from-code";
import { worldMapModel } from "./world-map-model";

// `?code=self`: this repository, its workspace packages as zones, as the
// end-to-end input of the whole pipeline.

const parse = () => {
  const started = performance.now();
  const result = codeGraphOf(selfFiles);
  const ms = performance.now() - started;
  if (result.codeGraph === null) {
    throw new Error(`self: ${result.error}`);
  }
  // A parser regression on known input must fail here, not drop a module.
  expect(result.skipped).toEqual([]);
  return { codeGraph: result.codeGraph, ms };
};

describe("the repository as a code world", { timeout: 30_000 }, () => {
  const { codeGraph, ms } = parse();
  const links = areaLinksOf(codeGraph);
  const linked = (from: string, to: string) =>
    links.some((link) => link.fromArea === from && link.toArea === to);

  it("parses quickly into a graph of every module", () => {
    expect(ms, `parse + graph took ${Math.round(ms)} ms`).toBeLessThan(5000);
    expect(codeGraph.modules.length).toBeGreaterThanOrEqual(100);
  });

  it("has a zone per workspace package with sources", () => {
    expect(zonesOf(codeGraph).map((zone) => zone.name)).toEqual(
      expect.arrayContaining([
        "web",
        "@repo/parser",
        "@repo/code-graph",
        "@repo/world-generator",
        "@repo/renderer",
        "@repo/types",
        "@repo/logger",
        "@repo/prettier",
      ])
    );
    expect(zonesOf(codeGraph)).toHaveLength(8);
  });

  it("resolves package subpaths and the app's ~/ alias", () => {
    expect(
      linked("apps/web/src/app.tsx", "packages/renderer/src/player.tsx")
    ).toBe(true);
    expect(linked("apps/web/src/app.tsx", "apps/web/src/hud.tsx")).toBe(true);
  });

  it("generates every area with variation, all passing the area checks", () => {
    const started = performance.now();
    const world = generateCodeWorld(codeGraph, 1);
    const generation = Math.round(performance.now() - started);
    expect(world.pending, `generation took ${generation} ms`).toEqual([]);
    expect(world.failed).toEqual([]);
    expect(checkAreas(world)).toEqual([]);
    const model = worldMapModel(world, { links });
    expect(model.areas.every((area) => area.state === "generated")).toBe(true);
    expect(model.areas).toHaveLength(world.areas.length);
  });

  // `packages/parser/src/resolve.ts` failed on half the seeds before hubs
  // could step down to fewer doors (`HUB_DOOR_LADDER`).
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "lays out every module on seed %i",
    (seed) => {
      const started = performance.now();
      const { world, errors } = codeAreaStore(codeGraph, seed, {
        variation: false,
        eager: true,
      }).snapshot();
      const generation = Math.round(performance.now() - started);
      expect([...errors], `generation took ${generation} ms`).toEqual([]);
      expect(checkAreas(world)).toEqual([]);
    }
  );
});
