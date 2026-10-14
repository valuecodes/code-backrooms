import { describe, expect, it } from "vitest";

import { areaLinksOf } from "./area-links";
import { fixtureGraph, importOf, packageNode, withPackages } from "./fixture";
import { ENTRANCE_ID } from "./ids";

/** `a.ts` imports `b.ts` and calls it twice; `b.ts` calls `c.ts` once. */
const chain = () =>
  fixtureGraph(
    {
      path: "a.ts",
      imports: [importOf("b.ts")],
      functions: [
        { name: "main", calls: ["b.ts::two", "b.ts::three", "helper"] },
        { name: "helper" },
      ],
    },
    {
      path: "b.ts",
      functions: [{ name: "two", calls: ["c.ts::four"] }, { name: "three" }],
    },
    { path: "c.ts", functions: [{ name: "four" }] }
  );

const WEB_MAIN = "apps/web/src/main.ts";
const WEB_UTIL = "apps/web/src/util.ts";
const LIB = "packages/lib/src/lib.ts";

/** An app calling into a library, both workspace packages. */
const monorepo = () =>
  withPackages(
    fixtureGraph(
      {
        path: WEB_MAIN,
        imports: [importOf(WEB_UTIL), importOf(LIB)],
        functions: [{ name: "main", calls: [`${LIB}::run`] }],
      },
      { path: WEB_UTIL, functions: [] },
      { path: LIB, functions: [{ name: "run" }] }
    ),
    packageNode("@repo/lib", "packages/lib"),
    packageNode("web", "apps/web", ["@repo/lib"])
  );

describe("areaLinksOf", () => {
  it("leads from the entrance to the entry modules, then along imports and calls", () => {
    expect(areaLinksOf(chain())).toEqual([
      { fromArea: ENTRANCE_ID, toArea: "a.ts", kind: "module", count: 1 },
      { fromArea: ENTRANCE_ID, toArea: "c.ts", kind: "module", count: 1 },
      { fromArea: "a.ts", toArea: "b.ts", kind: "module", count: 1 },
      { fromArea: "a.ts", toArea: "b.ts", kind: "call", count: 2 },
      { fromArea: "b.ts", toArea: "c.ts", kind: "call", count: 1 },
    ]);
  });

  it("links a choice to every other module it offers, once per site", () => {
    const graph = chain();
    const [first] = graph.callSites;
    if (first === undefined) {
      throw new Error("chain has no call sites");
    }
    const choice = {
      ...first,
      id: `${first.callerId}@999`,
      calleeId: null,
      resolution: "ambiguous" as const,
      candidateIds: ["a.ts::helper", "b.ts::three", "c.ts::four"],
    };
    const links = areaLinksOf({
      ...graph,
      callSites: [...graph.callSites, choice],
    }).filter((link) => link.kind === "call" && link.fromArea === "a.ts");
    expect(links).toEqual([
      { fromArea: "a.ts", toArea: "b.ts", kind: "call", count: 3 },
      { fromArea: "a.ts", toArea: "c.ts", kind: "call", count: 1 },
    ]);
  });

  it("never links a module to itself", () => {
    const links = areaLinksOf(chain());
    expect(links.filter((link) => link.fromArea === link.toArea)).toEqual([]);
  });

  it("includes and counts resolved top-level call sites", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [{ name: "main", calls: ["b.ts::run"] }] },
      { path: "b.ts", functions: [{ name: "run" }] }
    );
    const [site] = graph.callSites;
    if (site === undefined) {
      throw new Error("Fixture call site is missing");
    }
    const links = areaLinksOf({
      ...graph,
      callSites: [
        ...graph.callSites,
        { ...site, id: "a.ts@top-level-1", callerId: "a.ts" },
        { ...site, id: "a.ts@top-level-2", callerId: "a.ts" },
      ],
    });

    expect(links).toContainEqual({
      fromArea: "a.ts",
      toArea: "b.ts",
      kind: "call",
      count: 3,
    });
  });

  it("leads from the entrance to the zones' hubs and from each hub to its entries", () => {
    expect(areaLinksOf(monorepo())).toEqual([
      { fromArea: ENTRANCE_ID, toArea: "//zone:web", kind: "module", count: 1 },
      {
        fromArea: ENTRANCE_ID,
        toArea: "//zone:@repo/lib",
        kind: "module",
        count: 1,
      },
      { fromArea: "//zone:web", toArea: WEB_MAIN, kind: "module", count: 1 },
      { fromArea: "//zone:@repo/lib", toArea: LIB, kind: "module", count: 1 },
      { fromArea: WEB_MAIN, toArea: WEB_UTIL, kind: "module", count: 1 },
      { fromArea: WEB_MAIN, toArea: LIB, kind: "module", count: 1 },
      { fromArea: WEB_MAIN, toArea: LIB, kind: "call", count: 1 },
    ]);
  });

  it("credits a hub chain's later hubs to the area the chain starts", () => {
    const modules = Array.from({ length: 20 }, (_, index) => ({
      path: `m${String(index).padStart(2, "0")}.ts`,
      functions: [],
    }));
    const links = areaLinksOf(fixtureGraph(...modules));
    expect(links).toHaveLength(20);
    expect(new Set(links.map((link) => link.fromArea))).toEqual(
      new Set([ENTRANCE_ID])
    );
  });

  it("is the same list for the same graph", () => {
    const graph = chain();
    expect(areaLinksOf(graph)).toBe(areaLinksOf(graph));
    expect(areaLinksOf(chain())).toEqual(areaLinksOf(graph));
  });
});
