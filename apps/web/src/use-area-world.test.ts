import { ENTRANCE_ID, modulePortalId } from "@repo/code-graph/ids";
import { buildCodeGraph } from "@repo/parser";
import type { BuiltArea } from "@repo/types";
import { checkAreas } from "@repo/world-generator/area-checks";
import { mergeAreas } from "@repo/world-generator/areas";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import {
  builtModules,
  storeFor,
  targetAreaOf,
  warningsOf,
  zoneProgress,
} from "./use-area-world";
import type { WorldOptions } from "./use-area-world";
import { areasFromCode, codeGraphOf } from "./world-from-code";

const repo = () => {
  const { codeGraph, error } = codeGraphOf("repo");
  if (codeGraph === null) {
    throw new Error(`repo: ${error}`);
  }
  return codeGraph;
};

const options = (overrides: Partial<WorldOptions> = {}): WorldOptions => ({
  codeGraph: repo(),
  codeError: null,
  eager: false,
  rooms: 15,
  preset: null,
  ...overrides,
});

/** The store of a source, or the test fails with its error. */
const storeOf = (seed: number, overrides: Partial<WorldOptions> = {}) => {
  const source = storeFor(seed, options(overrides));
  if (source.store === null) {
    throw new Error(source.error);
  }
  return source.store;
};

/** Every room id of some areas, sorted. */
const roomIds = (areas: readonly BuiltArea[]): readonly string[] =>
  areas.flatMap((area) => area.graph.rooms.map((room) => room.id)).toSorted();

describe("storeFor", () => {
  it("starts a code world in its entrance alone", () => {
    const { world } = storeOf(1).snapshot();
    expect(world.areas.map((area) => area.id)).toEqual([ENTRANCE_ID]);
    expect(world.pending).toHaveLength(repo().modules.length);
  });

  it("generates every module up front when eager", () => {
    const { world } = storeOf(1, { eager: true }).snapshot();
    expect(world.pending).toEqual([]);
    expect(world.areas).toEqual(areasFromCode(repo(), 1).areas);
  });

  it("makes a random or preset world one area", () => {
    for (const preset of [null, "hub"] as const) {
      const { world } = storeOf(2, { codeGraph: null, preset }).snapshot();
      expect(world.areas).toHaveLength(1);
      expect(world.pending).toEqual([]);
    }
  });

  it("turns a parse error or a failed first area into a value", () => {
    expect(storeFor(1, options({ codeError: "Unexpected token" }))).toEqual({
      store: null,
      error: "Unexpected token",
    });
    const empty = { ...repo(), modules: [] };
    const failed = storeFor(1, options({ codeGraph: empty }));
    expect(failed.store).toBeNull();
    expect(failed.error).toContain("at least one module");
  });
});

describe("targetAreaOf", () => {
  it("names the area a portal leads into, pending or not", () => {
    const { world } = storeOf(1).snapshot();
    const portal = modulePortalId(ENTRANCE_ID, "src/index.ts");
    expect(targetAreaOf(world, portal)).toBe("src/index.ts");
    expect(targetAreaOf(world, "no such portal")).toBeNull();
  });
});

/** The area with one connection and one portal from `id` left out. */
const withGaps = (area: BuiltArea, id: string): BuiltArea => ({
  ...area,
  layout: {
    ...area.layout,
    unresolved: [{ from: id, to: "b" }],
    unplacedPortals: [
      { id: `portal:${id}>b`, kind: "call" as const, from: id, to: "b" },
    ],
  },
});

describe("warningsOf", () => {
  it("lists what every area left out, then the areas that failed", () => {
    const world = storeOf(1, { eager: true }).snapshot().world;
    const [first, second, ...rest] = world.areas;
    if (first === undefined || second === undefined) {
      throw new Error("repo has fewer than two areas");
    }
    const gaps = {
      ...world,
      areas: [withGaps(first, "a"), withGaps(second, "c"), ...rest],
    };
    expect(warningsOf(gaps, new Map([["src/x.ts", "no room"]]))).toEqual([
      "a -> b could not be laid out",
      "c -> b could not be laid out",
      "portal:a>b has no wall space",
      "portal:c>b has no wall space",
      "src/x.ts could not be generated: no room",
    ]);
  });
});

describe("a lazy walk through the repo example", () => {
  it("reaches every module through portals and stays valid each step", () => {
    for (const seed of [1, 2, 3]) {
      const store = storeOf(seed);
      for (;;) {
        const { world } = store.snapshot();
        const next = world.areas
          .flatMap((area) => area.graph.portals ?? [])
          .map((portal) => targetAreaOf(world, portal.id))
          .find((area) => area !== null && world.pending.includes(area));
        if (next === undefined || next === null) {
          break;
        }
        expect("area" in store.ensure(next)).toBe(true);
        expect(checkAreas(store.snapshot().world), `seed ${seed}`).toEqual([]);
      }
      const { world } = store.snapshot();
      expect(world.pending).toEqual([]);
      expect(roomIds(world.areas)).toEqual(
        roomIds(areasFromCode(repo(), seed).areas)
      );
    }
  });

  it("lands a portal entered into a pending area once it is ensured", () => {
    const store = storeOf(1);
    const portal = modulePortalId(ENTRANCE_ID, "src/index.ts");
    const before = mergeAreas(store.snapshot().world);
    const idle = createNavigator(before).step(
      { frames: [], roomId: ENTRANCE_ID },
      { type: "portal", portalId: portal }
    );
    expect(idle.teleport).toBeNull();
    store.ensure("src/index.ts");
    const after = mergeAreas(store.snapshot().world);
    const entered = createNavigator(after).step(
      { frames: [], roomId: ENTRANCE_ID },
      { type: "portal", portalId: portal }
    );
    expect(entered.state.roomId).toBe("src/index.ts");
    expect(entered.teleport).not.toBeNull();
    // The entrance did not move: the player's start is where it was.
    expect(after.built.start).toBe(before.built.start);
  });
});

/** An app of two modules importing a library of one, as workspace packages. */
const workspace = () =>
  buildCodeGraph([
    {
      path: "apps/web/package.json",
      source: JSON.stringify({
        name: "web",
        dependencies: { "@repo/lib": "workspace:*" },
      }),
    },
    {
      path: "apps/web/src/main.ts",
      source: 'import "./util";\nimport { run } from "@repo/lib";\nrun();',
    },
    { path: "apps/web/src/util.ts", source: "export const util = 1;" },
    {
      path: "packages/lib/package.json",
      source: JSON.stringify({ name: "@repo/lib", main: "src/lib.ts" }),
    },
    { path: "packages/lib/src/lib.ts", source: "export function run() {}" },
  ]);

describe("modules and zones of a workspace", () => {
  const store = () => storeOf(1, { codeGraph: workspace() });

  it("counts modules only, not the entrance or the zones' hubs", () => {
    const zoned = store();
    expect(builtModules(zoned.snapshot().world, true)).toBe(0);
    zoned.ensure("//zone:web");
    expect(builtModules(zoned.snapshot().world, true)).toBe(0);
    zoned.ensure("apps/web/src/main.ts");
    expect(builtModules(zoned.snapshot().world, true)).toBe(1);
    zoned.ensureAll();
    expect(builtModules(zoned.snapshot().world, true)).toBe(3);
  });

  it("counts a random world's one area", () => {
    const random = storeOf(1, { codeGraph: null });
    expect(builtModules(random.snapshot().world, false)).toBe(1);
  });

  it("names the zone the player is in with its modules so far", () => {
    const zoned = store();
    zoned.ensure("//zone:web");
    zoned.ensure("apps/web/src/main.ts");
    const { world } = zoned.snapshot();
    const web = { name: "web", built: 1, total: 2 };
    expect(zoneProgress(world, null)).toBeNull();
    expect(zoneProgress(world, ENTRANCE_ID)).toBeNull();
    expect(zoneProgress(world, "//zone:web")).toEqual(web);
    expect(zoneProgress(world, "apps/web/src/main.ts")).toEqual(web);
    // A corridor is no unit: a room missing from `areaOf` is found by layout.
    expect(
      zoneProgress({ ...world, areaOf: new Map() }, "apps/web/src/main.ts")
    ).toEqual(web);
    expect(zoneProgress(world, "packages/lib/src/lib.ts")).toEqual({
      name: "@repo/lib",
      built: 0,
      total: 1,
    });
  });

  it("finds no zone in a world of one package", () => {
    const { world } = storeOf(1).snapshot();
    expect(world.zones).toEqual([]);
    expect(zoneProgress(world, "src/index.ts")).toBeNull();
  });
});
