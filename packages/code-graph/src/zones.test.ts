import { describe, expect, it } from "vitest";

import { demoGraph, fixtureGraph, packageNode, withPackages } from "./fixture";
import { ENTRANCE_ID } from "./ids";
import {
  hasZones,
  isZoneHub,
  zoneId,
  zoneOfHub,
  zoneOfModule,
  zonesOf,
} from "./zones";

/** An app using a library, a tool nobody uses, and a file none owns. */
const monorepo = () =>
  withPackages(
    fixtureGraph(
      { path: "apps/web/src/main.ts", functions: [] },
      { path: "packages/lib/src/a.ts", functions: [] },
      { path: "packages/lib/src/b.ts", functions: [] },
      { path: "scripts/build.ts", functions: [] },
      { path: "tools/cli/index.ts", functions: [] }
    ),
    packageNode("@repo/lib", "packages/lib"),
    packageNode("web", "apps/web", ["@repo/lib"]),
    packageNode("cli", "tools/cli"),
    packageNode("@repo/empty", "packages/empty")
  );

describe("zonesOf", () => {
  it("is one zone of every module without packages", () => {
    const graph = demoGraph();
    expect(zonesOf(graph)).toEqual([
      {
        id: "//zone",
        name: "repository",
        pkg: null,
        modules: graph.modules,
      },
    ]);
    expect(hasZones(graph)).toBe(false);
  });

  it("is one zone for a single package owning everything", () => {
    const graph = withPackages(
      fixtureGraph(
        { path: "src/a.ts", functions: [] },
        { path: "src/b.ts", functions: [] }
      ),
      packageNode("solo", "")
    );
    expect(zonesOf(graph).map((zone) => zone.name)).toEqual(["solo"]);
    expect(hasZones(graph)).toBe(false);
  });

  it("puts packages nobody depends on first, then by directory, the rest last", () => {
    const graph = monorepo();
    expect(
      zonesOf(graph).map((zone) => [
        zone.id,
        zone.name,
        zone.modules.map((module) => module.id),
      ])
    ).toEqual([
      ["//zone:web", "web", ["apps/web/src/main.ts"]],
      ["//zone:cli", "cli", ["tools/cli/index.ts"]],
      [
        "//zone:@repo/lib",
        "@repo/lib",
        ["packages/lib/src/a.ts", "packages/lib/src/b.ts"],
      ],
      ["//zone", "repository", ["scripts/build.ts"]],
    ]);
    expect(hasZones(graph)).toBe(true);
  });

  it("gives a package without modules no zone", () => {
    expect(
      zonesOf(monorepo()).some((zone) => zone.name === "@repo/empty")
    ).toBe(false);
  });

  it("is computed once per graph", () => {
    const graph = monorepo();
    expect(zonesOf(graph)).toBe(zonesOf(graph));
  });
});

describe("zone ids", () => {
  it("names a package's zone and the zone of the rest", () => {
    expect(zoneId("@repo/lib")).toBe("//zone:@repo/lib");
    expect(zoneId(null)).toBe("//zone");
    expect(zoneId("odd#2")).toBe("//zone:odd%232");
  });

  it("knows every hub of a zone's chain and nothing else", () => {
    expect(isZoneHub("//zone:@repo/lib")).toBe(true);
    expect(isZoneHub("//zone:@repo/lib#2")).toBe(true);
    expect(isZoneHub("//zone")).toBe(true);
    expect(isZoneHub("//zone#3")).toBe(true);
    expect(isZoneHub(ENTRANCE_ID)).toBe(false);
    expect(isZoneHub("src/zone.ts")).toBe(false);
    expect(isZoneHub("//zones")).toBe(false);
  });

  it("finds a zone by its hubs and by its modules", () => {
    const graph = monorepo();
    expect(zoneOfHub(graph, "//zone:@repo/lib#2")?.name).toBe("@repo/lib");
    expect(zoneOfHub(graph, "//zone")?.name).toBe("repository");
    expect(zoneOfHub(graph, "//zone:@repo/empty")).toBeNull();
    expect(zoneOfHub(graph, "packages/lib/src/a.ts")).toBeNull();
    expect(zoneOfModule(graph, "packages/lib/src/b.ts")?.id).toBe(
      "//zone:@repo/lib"
    );
    expect(zoneOfModule(graph, "missing.ts")).toBeNull();
  });

  it("keeps a package whose name ends like a chain apart from the chain", () => {
    const graph = withPackages(
      fixtureGraph(
        { path: "a/x.ts", functions: [] },
        { path: "b/y.ts", functions: [] }
      ),
      packageNode("a", "a"),
      packageNode("a#2", "b")
    );
    const ids = zonesOf(graph).map((zone) => zone.id);
    expect(ids).toEqual(["//zone:a", "//zone:a%232"]);
    expect(zoneOfHub(graph, "//zone:a#2")?.name).toBe("a");
    expect(zoneOfHub(graph, "//zone:a%232")?.name).toBe("a#2");
  });
});
