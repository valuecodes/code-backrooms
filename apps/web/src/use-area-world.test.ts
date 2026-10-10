import { ENTRANCE_ID, modulePortalId } from "@repo/code-graph/ids";
import type { BuiltArea } from "@repo/types";
import { checkAreas } from "@repo/world-generator/area-checks";
import { mergeAreas } from "@repo/world-generator/areas";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import { storeFor, targetAreaOf, warningsOf } from "./use-area-world";
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

describe("warningsOf", () => {
  it("lists what was left out, then the areas that failed", () => {
    const world = mergeAreas(storeOf(1).snapshot().world);
    const gaps = {
      ...world,
      layout: {
        ...world.layout,
        unresolved: [{ from: "a", to: "b" }],
        unplacedPortals: [
          { id: "portal:a>b", kind: "call" as const, from: "a", to: "b" },
        ],
      },
    };
    expect(warningsOf(gaps, new Map([["src/x.ts", "no room"]]))).toEqual([
      "a -> b could not be laid out",
      "portal:a>b has no wall space",
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
