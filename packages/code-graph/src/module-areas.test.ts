import { checkAreas } from "@repo/world-generator/area-checks";
import { mergeAreas } from "@repo/world-generator/areas";
import { roomBounds } from "@repo/world-generator/geometry";
import { containsPoint } from "@repo/world-generator/locate";
import { describe, expect, it } from "vitest";

import { demoGraph, fixtureGraph, importOf } from "./fixture";
import { ENTRANCE_ID, modulePortalId } from "./ids";
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
  it("starts a one-module graph in an entrance leading to it", () => {
    const world = generateCodeWorld(demoGraph(), 1);
    expect(world.entry).toBe(ENTRANCE_ID);
    expect(world.areas.map((area) => area.id)).toEqual([
      ENTRANCE_ID,
      "demo.ts",
    ]);
    const [entrance, demo] = world.areas;
    expect(entrance?.offset).toEqual({ x: 0, z: 0 });
    expect(entrance?.graph.portals).toEqual([
      expect.objectContaining({
        id: modulePortalId(ENTRANCE_ID, "demo.ts"),
        kind: "module",
        to: "demo.ts",
      }),
    ]);
    expect(demo?.graph.external).toBeUndefined();
    expect(checkAreas(world)).toEqual([]);
  });

  it("spawns inside the entrance, facing its first portal", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const world = generateCodeWorld(demoGraph(), seed);
      const merged = mergeAreas(world);
      expect(merged.layout.startRoomId).toBe(ENTRANCE_ID);
      const hub = merged.layout.rooms.find((room) => room.id === ENTRANCE_ID);
      const portal = merged.built.portals.find(
        ({ portal: { from } }) => from === ENTRANCE_ID
      );
      expect(
        hub !== undefined && containsPoint(roomBounds(hub), merged.built.start)
      ).toBe(true);
      const { start, facing } = merged.built;
      const frame = portal?.frame;
      expect(frame).toBeDefined();
      // The facing point sits on the portal's wall, level with its centre.
      const [x = 0, , z = 0] = frame?.center ?? [];
      expect(frame?.axis === "x" ? facing.x : facing.z, `seed ${seed}`).toBe(
        frame?.axis === "x" ? x : z
      );
      expect(
        (facing.x - start.x) * (x - start.x) +
          (facing.z - start.z) * (z - start.z)
      ).toBeGreaterThan(0);
    }
  });

  it("makes an area per module, joined by module and call portals", () => {
    const graph = twoModules();
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = generateCodeWorld(graph, seed);
      expect(world.areas.map((area) => area.id)).toEqual([
        ENTRANCE_ID,
        "lib.ts",
        "main.ts",
      ]);
      expect(checkAreas(world), `seed ${seed}`).toEqual([]);
    }
  });

  it("leads from the entrance to the modules nobody imports", () => {
    const graph = fixtureGraph(
      { path: "a.ts", functions: [{ name: "helper" }] },
      {
        path: "b.ts",
        functions: [{ name: "main", calls: ["a.ts::helper"] }],
        imports: [importOf("a.ts", "helper")],
      }
    );
    const world = generateCodeWorld(graph, 1);
    const portals = world.areas.flatMap((area) => area.graph.portals ?? []);
    expect(
      portals
        .filter((portal) => portal.kind === "module")
        .map((portal) => portal.id)
    ).toEqual([
      modulePortalId(ENTRANCE_ID, "b.ts"),
      modulePortalId("b.ts", "a.ts"),
    ]);
    expect(world.areas.find((area) => area.id === "b.ts")?.offset).not.toEqual({
      x: 0,
      z: 0,
    });
    expect(checkAreas(world)).toEqual([]);
  });

  it("reaches every module from the entrance, however many nobody imports", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `m${index}.ts`);
    const graph = fixtureGraph(
      ...paths.map((path) => ({ path, functions: [{ name: "run" }] })),
      { path: "shared.ts", functions: [] }
    );
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = generateCodeWorld(graph, seed);
      const entrance = world.areas.find((area) => area.id === ENTRANCE_ID);
      expect(entrance?.graph.rooms.map((room) => room.id)).toEqual([
        ENTRANCE_ID,
        `${ENTRANCE_ID}#2`,
      ]);
      expect(entrance?.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
      expect(
        (entrance?.graph.portals ?? []).map((portal) => portal.to).toSorted()
      ).toEqual([...paths, "shared.ts"].toSorted());
      expect(checkAreas(world), `seed ${seed}`).toEqual([]);
    }
  });

  it("keeps a module called entrance apart from the entrance", () => {
    const graph = fixtureGraph(
      { path: "entrance", functions: [{ name: "go" }] },
      { path: "entrance#2", functions: [{ name: "again" }] }
    );
    const world = generateCodeWorld(graph, 1);
    expect(world.areas.map((area) => area.id)).toEqual([
      ENTRANCE_ID,
      "entrance",
      "entrance#2",
    ]);
    expect(world.areaOf.get(ENTRANCE_ID)).toBe(ENTRANCE_ID);
    expect(world.areaOf.get("entrance")).toBe("entrance");
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
