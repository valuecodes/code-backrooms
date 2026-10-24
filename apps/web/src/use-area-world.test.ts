import { ENTRANCE_ID, modulePortalId } from "@repo/code-graph/ids";
import { buildCodeGraph } from "@repo/parser";
import type { BuiltArea } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { checkAreas } from "@repo/world-generator/area-checks";
import { createAreaStore } from "@repo/world-generator/area-store";
import type { AreaStore } from "@repo/world-generator/area-store";
import { mergeAreas } from "@repo/world-generator/areas";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import {
  builtModules,
  candidatesOf,
  ensureNext,
  portalUnits,
  storeFor,
  targetAreaOf,
  warningsOf,
  zoneProgress,
} from "./use-area-world";
import type { WorldOptions } from "./use-area-world";
import { areasFromCode, codeGraphOf } from "./world-from-code";

const repo = () => {
  const { codeGraph, error } = codeGraphOf(examples.repo);
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

/** Each area of a store with where it was placed, in generation order. */
const placed = (store: AreaStore) =>
  store.snapshot().world.areas.map(({ id, offset }) => ({ id, offset }));

describe("ensureNext", () => {
  it("generates the first pending area and reports true", () => {
    const store = storeOf(1);
    const [first, ...rest] = store.snapshot().world.pending;
    expect(ensureNext(store)).toBe(true);
    const { world } = store.snapshot();
    expect(world.areas.at(-1)?.id).toBe(first);
    expect(world.pending).toEqual(rest);
  });

  it("reports false once nothing is pending", () => {
    const store = storeOf(1);
    store.ensureAll();
    const before = store.snapshot();
    expect(ensureNext(store)).toBe(false);
    expect(store.snapshot()).toBe(before);
  });

  it("stepping to the end gives the areas ensureAll gives, in its order", () => {
    const stepped = storeOf(3);
    while (ensureNext(stepped)) {
      // One area per call.
    }
    const all = storeOf(3);
    all.ensureAll();
    expect(placed(stepped)).toEqual(placed(all));
  });

  it("keeps going past an area that fails", () => {
    const store = createAreaStore({
      seed: 1,
      entry: "a",
      specs: [
        { id: "a", units: [], generate: () => generateWorld({ seed: 1 }) },
        {
          id: "b",
          units: [],
          generate: () => {
            throw new Error("no room");
          },
        },
        { id: "c", units: [], generate: () => generateWorld({ seed: 2 }) },
      ],
    });
    let steps = 0;
    while (ensureNext(store)) {
      steps += 1;
    }
    const { world, errors } = store.snapshot();
    expect(steps).toBe(2);
    expect(world.areas.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(world.failed).toEqual(["b"]);
    expect(errors.get("b")).toContain("no room");
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

  it("lands a portal into an unloaded area once it is ensured again", () => {
    const store = storeOf(1);
    const portal = modulePortalId(ENTRANCE_ID, "src/index.ts");
    const state = { frames: [], roomId: ENTRANCE_ID };
    const event = { type: "portal", portalId: portal } as const;
    store.ensure("src/index.ts");
    const first = createNavigator(mergeAreas(store.snapshot().world)).step(
      state,
      event
    );
    store.evict("src/index.ts");
    expect(
      createNavigator(mergeAreas(store.snapshot().world)).step(state, event)
        .teleport
    ).toBeNull();
    store.ensure("src/index.ts");
    const again = createNavigator(mergeAreas(store.snapshot().world)).step(
      state,
      event
    );
    expect(again.teleport).toEqual(first.teleport);
  });
});

/** `s.run()` may be `Base.run` or the override in another file. */
const overrides = () => {
  const { codeGraph, error } = codeGraphOf([
    { path: "base.ts", source: "export class Base { run() {} }" },
    {
      path: "fast.ts",
      source:
        'import { Base } from "./base";\nexport class Fast extends Base { run() {} }',
    },
    {
      path: "main.ts",
      source:
        'import { Base } from "./base";\nimport "./fast";\nexport function main(s: Base) { s.run(); }',
    },
  ]);
  if (codeGraph === null) {
    throw new Error(`overrides: ${error}`);
  }
  return codeGraph;
};

describe("a choice with a candidate in another module", () => {
  it("lists the candidates and lands in the far one once its area is ensured", () => {
    const store = storeOf(1, { codeGraph: overrides(), eager: false });
    store.ensure("main.ts");
    const { world } = store.snapshot();
    const choice = world.areas
      .flatMap((area) => area.graph.portals ?? [])
      .find((portal) => portal.kind === "choice");
    if (choice === undefined) {
      throw new Error("no choice portal in main.ts");
    }
    expect(candidatesOf(world, choice.id)).toEqual([
      "base.ts::Base.run",
      "fast.ts::Fast.run",
    ]);
    expect(candidatesOf(world, "no such portal")).toEqual([]);
    // Its far side is its own unit, then every candidate.
    expect(portalUnits(world, choice.id)).toEqual([
      choice.to,
      "base.ts::Base.run",
      "fast.ts::Fast.run",
    ]);
    expect(portalUnits(world, "no such portal")).toEqual([]);
    const state = { frames: [], roomId: "main.ts::main" };
    const event = {
      type: "choose",
      portalId: choice.id,
      calleeId: "fast.ts::Fast.run",
    } as const;
    expect(
      createNavigator(mergeAreas(world)).step(state, event).teleport
    ).toBeNull();
    const area = world.areaOf.get("fast.ts::Fast.run");
    expect(area).toBe("fast.ts");
    store.ensure(area ?? "");
    expect(checkAreas(store.snapshot().world)).toEqual([]);
    const entered = createNavigator(mergeAreas(store.snapshot().world)).step(
      state,
      event
    );
    expect(entered.state.roomId).toBe("fast.ts::Fast.run");
    expect(entered.teleport).not.toBeNull();
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

const workspaceStore = () => storeOf(1, { codeGraph: workspace() });

describe("modules and zones of a workspace", () => {
  it("counts modules only, not the entrance or the zones' hubs", () => {
    const zoned = workspaceStore();
    expect(builtModules(zoned.snapshot().world, true)).toBe(0);
    zoned.ensure("//zone:web");
    expect(builtModules(zoned.snapshot().world, true)).toBe(0);
    zoned.ensure("apps/web/src/main.ts");
    expect(builtModules(zoned.snapshot().world, true)).toBe(1);
    zoned.ensureAll();
    expect(builtModules(zoned.snapshot().world, true)).toBe(3);
  });

  it("counts an unloaded module as built, in the zone too", () => {
    const zoned = workspaceStore();
    zoned.ensure("//zone:web");
    zoned.ensure("apps/web/src/main.ts");
    zoned.ensure("apps/web/src/util.ts");
    zoned.evict("apps/web/src/util.ts");
    const { world } = zoned.snapshot();
    expect(world.unloaded.map(({ id }) => id)).toEqual([
      "apps/web/src/util.ts",
    ]);
    expect(builtModules(world, true)).toBe(2);
    expect(zoneProgress(world, "apps/web/src/main.ts")).toEqual({
      name: "web",
      built: 2,
      total: 2,
    });
  });

  it("counts a random world's one area", () => {
    const random = storeOf(1, { codeGraph: null });
    expect(builtModules(random.snapshot().world, false)).toBe(1);
  });

  it("names the zone the player is in with its modules so far", () => {
    const zoned = workspaceStore();
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
