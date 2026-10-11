import { areaLinksOf } from "@repo/code-graph/area-links";
import { ENTRANCE_ID } from "@repo/code-graph/ids";
import { codeAreaStore } from "@repo/code-graph/module-areas";
import { buildCodeGraph } from "@repo/parser";
import type { AreaWorld, Point, Rect } from "@repo/types";
import { AREA_GAP, stripRange } from "@repo/world-generator/areas";
import { describe, expect, it } from "vitest";

import { codeGraphOf } from "./world-from-code";
import { playerMarker, worldMapModel } from "./world-map-model";
import type { MapArea, WorldMapModel } from "./world-map-model";

const repo = () => {
  const { codeGraph, error } = codeGraphOf("repo");
  if (codeGraph === null) {
    throw new Error(`repo: ${error}`);
  }
  return codeGraph;
};

const json = (value: unknown): string => JSON.stringify(value);

/** An app calling into a library and its own util, both workspace packages. */
const workspace = () =>
  buildCodeGraph([
    { path: "package.json", source: json({ name: "mono", private: true }) },
    {
      path: "apps/web/package.json",
      source: json({
        name: "web",
        dependencies: { "@repo/lib": "workspace:*" },
      }),
    },
    {
      path: "apps/web/src/main.ts",
      source: [
        'import { run } from "@repo/lib";',
        'import { tidy } from "./util";',
        "export function main() { run(); tidy(); }",
      ].join("\n"),
    },
    { path: "apps/web/src/util.ts", source: "export function tidy() {}" },
    {
      path: "packages/lib/package.json",
      source: json({ name: "@repo/lib", exports: { ".": "./src/lib.ts" } }),
    },
    { path: "packages/lib/src/lib.ts", source: "export function run() {}" },
  ]);

const INDEX = "src/index.ts";
const SERVER = "src/server.ts";
const WEB_ZONE = "//zone:web";
const LIB_ZONE = "//zone:@repo/lib";
const MAIN = "apps/web/src/main.ts";

const areaOf = (model: WorldMapModel, id: string): MapArea => {
  const found = model.areas.find((area) => area.id === id);
  if (found === undefined) {
    throw new Error(`No area ${id}`);
  }
  return found;
};

const linkOf = (model: WorldMapModel, id: string) => {
  const found = model.links.find((link) => link.id === id);
  if (found === undefined) {
    throw new Error(`No link ${id}`);
  }
  return found;
};

const centreOf = (rect: Rect): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minZ >= outer.minZ &&
  inner.maxZ <= outer.maxZ;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

/** Each ghost's rect, by area id. */
const ghostRects = (model: WorldMapModel): ReadonlyMap<string, Rect> =>
  new Map(
    model.areas
      .filter((area) => area.state !== "generated")
      .map((area) => [area.id, area.rect])
  );

describe("worldMapModel", () => {
  it("draws every area not generated yet as a ghost, and none once all are", () => {
    const graph = repo();
    const store = codeAreaStore(graph, 1);
    const start = worldMapModel(store.snapshot().world);
    expect(start.areas.map((area) => [area.id, area.state])).toEqual([
      [ENTRANCE_ID, "generated"],
      ...graph.modules.map((module) => [module.id, "pending"]),
    ]);
    expect(
      start.areas
        .filter((area) => area.state === "pending")
        .map(({ rooms }) => rooms)
    ).toEqual(graph.modules.map(() => []));
    const entrance = areaOf(start, ENTRANCE_ID);
    expect(entrance.kind).toBe("entrance");
    expect(entrance.entry).toBe(true);
    expect(entrance.rooms.length).toBeGreaterThan(0);
    for (const room of entrance.rooms) {
      expect(contains(entrance.rect, room.rect)).toBe(true);
    }

    store.ensureAll();
    const done = worldMapModel(store.snapshot().world);
    expect(done.areas.every((area) => area.state === "generated")).toBe(true);
    expect(done.areas.filter((area) => area.kind === "module")).toHaveLength(
      graph.modules.length
    );
  });

  it("links the entrance to the entry module, with every link of the graph", () => {
    const graph = repo();
    const world = codeAreaStore(graph, 1).snapshot().world;
    const model = worldMapModel(world, { links: areaLinksOf(graph) });
    const entry = linkOf(model, `module:${ENTRANCE_ID}->${INDEX}`);
    expect(entry.target).toBe("pending");
    expect(entry.to).toEqual(centreOf(areaOf(model, INDEX).rect));
    expect(
      model.links.map(({ fromArea, toArea, kind, count }) => ({
        fromArea,
        toArea,
        kind,
        count,
      }))
    ).toEqual(areaLinksOf(graph));
  });

  it("starts a link at its source's ghost, then at its portal once generated", () => {
    const graph = repo();
    const store = codeAreaStore(graph, 1);
    const links = areaLinksOf(graph);
    const id = `call:${INDEX}->${SERVER}`;
    const before = worldMapModel(store.snapshot().world, { links });
    expect(linkOf(before, id).from).toEqual(
      centreOf(areaOf(before, INDEX).rect)
    );

    store.ensure(INDEX);
    const world = store.snapshot().world;
    const after = worldMapModel(world, { links });
    const portal = world.areas
      .find((area) => area.id === INDEX)
      ?.built.portals.find(
        ({ portal: data }) =>
          data.kind === "call" && world.areaOf.get(data.to) === SERVER
      );
    expect(portal).toBeDefined();
    expect(linkOf(after, id).from).toEqual({
      x: portal?.frame.center[0],
      z: portal?.frame.center[2],
    });
    expect(linkOf(after, id).target).toBe("pending");
  });

  it("skips links into areas the world does not know", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const model = worldMapModel(world, {
      links: [
        {
          fromArea: ENTRANCE_ID,
          toArea: "nowhere.ts",
          kind: "module",
          count: 1,
        },
      ],
    });
    expect(model.links).toEqual([]);
  });

  it("marks an area that failed with its message", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const failed: AreaWorld = {
      ...world,
      pending: world.pending.filter((id) => id !== SERVER),
      failed: [SERVER],
    };
    const model = worldMapModel(failed, {
      errors: new Map([[SERVER, "no room for the hub"]]),
    });
    expect(areaOf(model, SERVER)).toMatchObject({
      state: "failed",
      error: "no room for the hub",
    });
    expect(areaOf(model, INDEX).error).toBeNull();
  });

  it("labels areas with labelOf", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const model = worldMapModel(world, { labelOf: (id) => `<${id}>` });
    expect(areaOf(model, INDEX).label).toBe(`<${INDEX}>`);
    expect(areaOf(model, ENTRANCE_ID).label).toBe(`<${ENTRANCE_ID}>`);
  });

  it("has bounds around every area and band", () => {
    const store = codeAreaStore(workspace(), 2);
    store.ensure(WEB_ZONE);
    store.ensure(MAIN);
    const model = worldMapModel(store.snapshot().world);
    for (const area of model.areas) {
      expect(contains(model.bounds, area.rect)).toBe(true);
    }
    for (const zone of model.zones) {
      expect(zone.rect === null || contains(model.bounds, zone.rect)).toBe(
        true
      );
    }
  });

  it("keeps a ghost in its slot while other areas generate, in any order", () => {
    const graph = repo();
    const first = codeAreaStore(graph, 1);
    const second = codeAreaStore(graph, 1);
    const start = ghostRects(worldMapModel(first.snapshot().world));
    const modules = graph.modules.map((module) => module.id);
    for (const id of modules.slice(0, 3)) {
      first.ensure(id);
    }
    for (const id of modules.slice(0, 3).toReversed()) {
      second.ensure(id);
    }
    const one = ghostRects(worldMapModel(first.snapshot().world));
    const other = ghostRects(worldMapModel(second.snapshot().world));
    expect(one.size).toBe(modules.length - 3);
    for (const [id, rect] of one) {
      expect(rect).toEqual(start.get(id));
      expect(other.get(id)).toEqual(rect);
    }
  });

  it("puts ghosts on a shelf above their strip, apart from every generated area", () => {
    const graph = workspace();
    const store = codeAreaStore(graph, 1);
    store.ensure(WEB_ZONE);
    const world = store.snapshot().world;
    const model = worldMapModel(world);
    const entrance = areaOf(model, ENTRANCE_ID).rect;
    const ghosts = model.areas.filter((area) => area.state !== "generated");
    const generated = model.areas.filter((area) => area.state === "generated");
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(ghost.rect.maxZ).toBeLessThanOrEqual(entrance.minZ - AREA_GAP);
      const strip =
        world.zones.findIndex((zone) => zone.id === ghost.zoneId) + 1;
      const range = stripRange(entrance.minX, strip);
      expect(ghost.rect.minX).toBeGreaterThanOrEqual(range.minX);
      expect(ghost.rect.maxX).toBeLessThanOrEqual(range.maxX);
      for (const other of [...ghosts, ...generated]) {
        expect(other === ghost || !overlaps(ghost.rect, other.rect)).toBe(true);
      }
    }
  });

  it("bands each zone around its areas and ghosts, counting its modules", () => {
    const graph = workspace();
    const store = codeAreaStore(graph, 1);
    const start = worldMapModel(store.snapshot().world);
    expect(
      start.zones.map(({ id, name, built, total }) => ({
        id,
        name,
        built,
        total,
      }))
    ).toEqual([
      { id: WEB_ZONE, name: "web", built: 0, total: 2 },
      { id: LIB_ZONE, name: "@repo/lib", built: 0, total: 1 },
    ]);
    store.ensure(WEB_ZONE);
    store.ensure(MAIN);
    const model = worldMapModel(store.snapshot().world);
    expect(model.zones.map(({ built, total }) => [built, total])).toEqual([
      [1, 2],
      [0, 1],
    ]);
    expect(areaOf(model, WEB_ZONE)).toMatchObject({
      kind: "zone",
      zoneId: WEB_ZONE,
    });
    expect(areaOf(model, MAIN).zoneId).toBe(WEB_ZONE);
    for (const zone of model.zones) {
      const members = model.areas.filter((area) => area.zoneId === zone.id);
      expect(members.length).toBeGreaterThan(0);
      for (const area of members) {
        expect(zone.rect !== null && contains(zone.rect, area.rect)).toBe(true);
      }
    }
    const [web, lib] = model.zones;
    expect(web?.rect && lib?.rect && overlaps(web.rect, lib.rect)).toBe(false);
  });

  it("is the same model for the same world", () => {
    const graph = workspace();
    const store = codeAreaStore(graph, 3);
    store.ensure(WEB_ZONE);
    const world = store.snapshot().world;
    const options = { links: areaLinksOf(graph) };
    expect(worldMapModel(world, options)).toEqual(
      worldMapModel(world, options)
    );
  });

  it("places the player in the area they stand in", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const entrance = world.areas[0];
    if (entrance === undefined) {
      throw new Error("No entrance");
    }
    const position = centreOf(entrance.bounds);
    const model = worldMapModel(world, {
      player: { position, facing: { x: position.x + 3, z: position.z + 4 } },
    });
    expect(model.player).toEqual({
      position,
      heading: { x: 0.6, z: 0.8 },
      areaId: ENTRANCE_ID,
    });
  });
});

describe("playerMarker", () => {
  const world = codeAreaStore(repo(), 1).snapshot().world;

  it("faces from the position towards the point faced", () => {
    const position = { x: 500, z: -300 };
    expect(
      playerMarker(world, { position, facing: { x: 500, z: -310 } }).heading
    ).toEqual({ x: 0, z: -1 });
  });

  it("faces +Z when the point faced is the position, and is in no area between areas", () => {
    const position = { x: 1e6, z: 1e6 };
    expect(playerMarker(world, { position, facing: position })).toEqual({
      position,
      heading: { x: 0, z: 1 },
      areaId: null,
    });
  });
});
