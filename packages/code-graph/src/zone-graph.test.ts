import type { WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { describe, expect, it } from "vitest";

import { fixtureGraph, importOf, packageNode, withPackages } from "./fixture";
import { ENTRANCE_ID, modulePortalId } from "./ids";
import { zoneEntranceGraph, zoneGraph } from "./zone-graph";
import { zonesOf } from "./zones";

/** `count` packages `p0` and on, one module each, in a `mono` repository. */
const packagesGraph = (count: number) =>
  withPackages(
    fixtureGraph(
      ...Array.from({ length: count }, (_, index) => ({
        path: `packages/p${index}/src/index.ts`,
        functions: [],
      }))
    ),
    packageNode("mono", ""),
    ...Array.from({ length: count }, (_, index) =>
      packageNode(`p${index}`, `packages/p${index}`)
    )
  );

/** Every portal placed for seeds 1 to 8. */
const placesEverything = (world: WorldGraph) => {
  expect(() => validateGraph(world)).not.toThrow();
  for (let seed = 1; seed <= 8; seed += 1) {
    const generated = generateWorld({ seed, graph: world });
    expect(generated.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
  }
};

describe("zoneEntranceGraph", () => {
  it("leads to every zone's hub, labelled by its package", () => {
    const graph = packagesGraph(2);
    const world = zoneEntranceGraph(graph, zonesOf(graph));
    expect(world.rooms).toEqual([
      expect.objectContaining({ id: ENTRANCE_ID, label: "mono", hub: true }),
    ]);
    expect(world.portals).toEqual([
      {
        id: modulePortalId(ENTRANCE_ID, "//zone:p0"),
        kind: "module",
        from: ENTRANCE_ID,
        to: "//zone:p0",
        label: "p0",
      },
      {
        id: modulePortalId(ENTRANCE_ID, "//zone:p1"),
        kind: "module",
        from: ENTRANCE_ID,
        to: "//zone:p1",
        label: "p1",
      },
    ]);
    expect(world.start).toBe(ENTRANCE_ID);
    expect(world.external).toEqual(["//zone:p0", "//zone:p1"]);
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("chains a second hub past eight zones", () => {
    const graph = packagesGraph(9);
    const world = zoneEntranceGraph(graph, zonesOf(graph));
    expect(world.rooms.map((room) => room.id)).toEqual([
      ENTRANCE_ID,
      `${ENTRANCE_ID}#2`,
    ]);
    placesEverything(world);
  });
});

describe("zoneGraph", () => {
  it("leads from the zone's hub to its entry modules, by path in the package", () => {
    const graph = withPackages(
      fixtureGraph(
        { path: "packages/lib/src/index.ts", functions: [] },
        { path: "packages/lib/src/cli.ts", functions: [] },
        { path: "apps/web/main.ts", functions: [] }
      ),
      packageNode("@repo/lib", "packages/lib"),
      packageNode("web", "apps/web")
    );
    const lib = zonesOf(graph).find((zone) => zone.name === "@repo/lib");
    if (lib === undefined) {
      throw new Error("Expected a zone for @repo/lib");
    }
    const world = zoneGraph(graph, lib);
    expect(world.rooms).toEqual([
      expect.objectContaining({
        id: "//zone:@repo/lib",
        label: "@repo/lib",
        hub: true,
      }),
    ]);
    expect(
      (world.portals ?? []).map(({ from, to, label }) => [from, to, label])
    ).toEqual([
      ["//zone:@repo/lib", "packages/lib/src/cli.ts", "src/cli.ts"],
      ["//zone:@repo/lib", "packages/lib/src/index.ts", "src/index.ts"],
    ]);
    expect(world.start).toBe("//zone:@repo/lib");
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("chains its hubs past eight entries and places them all", () => {
    const graph = withPackages(
      fixtureGraph(
        ...Array.from({ length: 10 }, (_, index) => ({
          path: `packages/big/m${index}.ts`,
          functions: [],
        })),
        { path: "apps/web/main.ts", functions: [] }
      ),
      packageNode("big", "packages/big"),
      packageNode("web", "apps/web")
    );
    const big = zonesOf(graph).find((zone) => zone.name === "big");
    if (big === undefined) {
      throw new Error("Expected a zone for big");
    }
    const world = zoneGraph(graph, big);
    expect(world.rooms.map((room) => room.id)).toEqual([
      "//zone:big",
      "//zone:big#2",
    ]);
    expect(world.connections).toEqual([
      { from: "//zone:big", to: "//zone:big#2" },
    ]);
    placesEverything(world);
  });

  it("scores entry modules by their path inside the package", () => {
    const graph = withPackages(
      fixtureGraph(
        {
          path: "packages/lib/helper.ts",
          functions: [],
          imports: [importOf("packages/lib/src/api.ts")],
        },
        {
          path: "packages/lib/src/api.ts",
          functions: [{ name: "fetchAll", exported: true }],
          imports: [importOf("packages/lib/helper.ts")],
        },
        { path: "apps/web/main.ts", functions: [] }
      ),
      packageNode("@repo/lib", "packages/lib"),
      packageNode("web", "apps/web")
    );
    const lib = zonesOf(graph).find((zone) => zone.name === "@repo/lib");
    if (lib === undefined) {
      throw new Error("Expected a zone for @repo/lib");
    }
    // In the cycle, src/api.ts (API, no depth inside the package) beats
    // helper.ts; scored from the repository root they would tie on depth.
    expect((zoneGraph(graph, lib).portals ?? []).map((p) => p.to)).toEqual([
      "packages/lib/src/api.ts",
    ]);
  });

  it("keeps whole paths for the modules no package owns", () => {
    const graph = withPackages(
      fixtureGraph(
        { path: "apps/web/main.ts", functions: [] },
        { path: "scripts/build.ts", functions: [] }
      ),
      packageNode("web", "apps/web")
    );
    const rest = zonesOf(graph).find((zone) => zone.pkg === null);
    if (rest === undefined) {
      throw new Error("Expected a zone for unowned modules");
    }
    expect((zoneGraph(graph, rest).portals ?? []).map((p) => p.label)).toEqual([
      "scripts/build.ts",
    ]);
  });
});
