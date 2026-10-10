import { checkAreas } from "@repo/world-generator/area-checks";
import { mergeAreas } from "@repo/world-generator/areas";
import { roomBounds } from "@repo/world-generator/geometry";
import { containsPoint } from "@repo/world-generator/locate";
import { describe, expect, it } from "vitest";

import { demoGraph, fixtureGraph, importOf } from "./fixture";
import { generateCodeWorld } from "./module-areas";

/** `main.ts` imports `lib.ts` and calls into it; `lib.ts` calls back. */
const twoModules = () =>
  fixtureGraph(
    {
      path: "lib.ts",
      functions: [
        { name: "load", calls: ["parse"] },
        { name: "parse", calls: ["main.ts::report"] },
      ],
      imports: [importOf("main.ts", "report")],
    },
    {
      path: "main.ts",
      functions: [
        { name: "main", lines: 4, calls: ["lib.ts::load", "report"] },
        { name: "report", lines: 1 },
      ],
      imports: [importOf("lib.ts", "load")],
    }
  );

describe("generateCodeWorld", () => {
  it("lays a one-module graph out as a single area at the origin", () => {
    const world = generateCodeWorld(demoGraph(), 1);
    expect(world.entry).toBe("demo.ts");
    expect(world.areas.map((area) => area.id)).toEqual(["demo.ts"]);
    expect(world.areas[0]?.offset).toEqual({ x: 0, z: 0 });
    expect(world.areas[0]?.graph.external).toBeUndefined();
    expect(checkAreas(world)).toEqual([]);
  });

  it("makes an area per module, joined by module and call portals", () => {
    const graph = twoModules();
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = generateCodeWorld(graph, seed);
      expect(world.areas.map((area) => area.id)).toEqual(["lib.ts", "main.ts"]);
      expect(checkAreas(world), `seed ${seed}`).toEqual([]);
    }
  });

  it("starts in a module nobody imports, at the origin", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [{ name: "helper" }] },
      {
        path: "b.ts",
        functions: [{ name: "main", calls: ["a.ts::helper"] }],
        imports: [importOf("a.ts", "helper")],
      }
    );
    const world = generateCodeWorld(graph, 1);
    expect(world.entry).toBe("b.ts");
    const entry = world.areas.find((area) => area.id === "b.ts");
    expect(entry?.offset).toEqual({ x: 0, z: 0 });
    expect(world.areas.find((area) => area.id === "a.ts")?.offset).not.toEqual({
      x: 0,
      z: 0,
    });
    expect(entry?.graph.portals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "module", from: "b.ts", to: "a.ts" }),
      ])
    );
    expect(checkAreas(world)).toEqual([]);
  });

  it("leads from the entry to modules its imports never reach", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [{ name: "one" }] },
      { path: "b.ts", functions: [{ name: "two" }] },
      {
        path: "c.ts",
        functions: [{ name: "three" }],
        imports: [importOf("b.ts")],
      }
    );
    const world = generateCodeWorld(graph, 1);
    expect(world.entry).toBe("a.ts");
    const modulePortals = world.areas
      .flatMap((area) => area.graph.portals ?? [])
      .filter((portal) => portal.kind === "module")
      .map((portal) => portal.id);
    // c.ts reaches b.ts itself, so the entry needs no portal to b.ts.
    expect(modulePortals).toEqual(["module:a.ts>c.ts", "module:c.ts>b.ts"]);
    expect(checkAreas(world)).toEqual([]);
  });

  it("lands a cross-module call inside the callee's area once merged", () => {
    const world = generateCodeWorld(twoModules(), 3);
    const merged = mergeAreas(world);
    const call = merged.built.portals.find(
      ({ portal }) => portal.kind === "call" && portal.to === "lib.ts::load"
    );
    const lib = world.areas.find((area) => area.id === "lib.ts");
    const landing = call?.arrival?.position;
    expect(landing).toBeDefined();
    expect(
      landing !== undefined &&
        lib !== undefined &&
        containsPoint(lib.bounds, landing) &&
        lib.layout.rooms.some(
          (room) =>
            room.cluster === "lib.ts::load" &&
            containsPoint(roomBounds(room), landing)
        )
    ).toBe(true);
  });

  it("throws for a graph without modules", () => {
    expect(() =>
      generateCodeWorld(
        { modules: [], functions: [], callSites: [], edges: [] },
        1
      )
    ).toThrow(/at least one module/);
  });
});
