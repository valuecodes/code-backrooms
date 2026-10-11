import { checkAreas } from "@repo/world-generator/area-checks";
import { describe, expect, it } from "vitest";

import type { CodeGraph } from "./code-graph";
import { fixtureGraph, importOf, packageNode, withPackages } from "./fixture";
import { ENTRANCE_ID } from "./ids";
import { codeAreaStore, generateCodeWorld } from "./module-areas";

const MAIN = "apps/web/src/main.ts";
const UTIL = "apps/web/src/util.ts";
const LOAD = "packages/lib/src/load.ts";
const PARSE = "packages/lib/src/parse.ts";

/** An app importing and calling into a library, each with two modules. */
const workspace = (): CodeGraph =>
  withPackages(
    fixtureGraph(
      {
        path: MAIN,
        functions: [
          { name: "main", lines: 4, calls: [`${LOAD}::load`, "report"] },
          { name: "report" },
        ],
        imports: [importOf(UTIL, "util"), importOf(LOAD, "load")],
      },
      { path: UTIL, functions: [{ name: "util" }] },
      {
        path: LOAD,
        functions: [{ name: "load", calls: [`${PARSE}::parse`] }],
        imports: [importOf(PARSE, "parse")],
      },
      { path: PARSE, functions: [{ name: "parse" }] }
    ),
    packageNode("web", "apps/web", ["@repo/lib"]),
    packageNode("@repo/lib", "packages/lib")
  );

const WEB = "//zone:web";
const LIB = "//zone:@repo/lib";

describe("codeAreaStore with zones", () => {
  it("adds a hub area per zone between the entrance and the modules", () => {
    const world = generateCodeWorld(workspace(), 1);
    expect(world.areas.map(({ id, zoneId }) => [id, zoneId])).toEqual([
      [ENTRANCE_ID, null],
      [WEB, WEB],
      [LIB, LIB],
      [MAIN, WEB],
      [UTIL, WEB],
      [LOAD, LIB],
      [PARSE, LIB],
    ]);
    expect(world.zones.map(({ id, name, areas }) => [id, name, areas])).toEqual(
      [
        [WEB, "web", [WEB, MAIN, UTIL]],
        [LIB, "@repo/lib", [LIB, LOAD, PARSE]],
      ]
    );
  });

  it("leads the entrance to the zone hubs only, named after the packages", () => {
    const [entrance] = generateCodeWorld(workspace(), 1).areas;
    expect(
      (entrance?.graph.portals ?? []).map(({ kind, to, label }) => [
        kind,
        to,
        label,
      ])
    ).toEqual([
      ["module", WEB, "web"],
      ["module", LIB, "@repo/lib"],
    ]);
  });

  it("passes every area check for many seeds", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = generateCodeWorld(workspace(), seed);
      expect(checkAreas(world), `seed ${seed}`).toEqual([]);
    }
  });

  it("generates the entrance first, then a zone's hub, then its modules", () => {
    const store = codeAreaStore(workspace(), 3);
    const ids = () => store.snapshot().world.areas.map(({ id }) => id);
    expect(ids()).toEqual([ENTRANCE_ID]);
    expect(store.snapshot().world.pending).toEqual([
      WEB,
      LIB,
      MAIN,
      UTIL,
      LOAD,
      PARSE,
    ]);
    expect(store.ensure(WEB)).toHaveProperty("area.zoneId", WEB);
    expect(checkAreas(store.snapshot().world)).toEqual([]);
    expect(store.ensure(MAIN)).toHaveProperty("area.zoneId", WEB);
    expect(checkAreas(store.snapshot().world)).toEqual([]);
    expect(ids()).toEqual([ENTRANCE_ID, WEB, MAIN]);
  });

  it("builds a single package exactly as no packages", () => {
    const plain = fixtureGraph(
      {
        path: MAIN,
        functions: [{ name: "main", calls: [`${UTIL}::util`] }],
        imports: [importOf(UTIL, "util")],
      },
      { path: UTIL, functions: [{ name: "util" }] }
    );
    const single = withPackages(plain, packageNode("web", "apps/web"));
    for (const seed of [1, 2]) {
      const one = codeAreaStore(single, seed, { eager: true }).snapshot().world;
      expect(one).toEqual(
        codeAreaStore(plain, seed, { eager: true }).snapshot().world
      );
      expect(one.zones).toEqual([]);
      expect(one.areas.map(({ zoneId }) => zoneId)).toEqual([null, null, null]);
    }
  });
});
