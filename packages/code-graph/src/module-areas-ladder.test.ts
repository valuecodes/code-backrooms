import type * as WorldGenerator from "@repo/world-generator";
import type { GenerateWorldOptions } from "@repo/world-generator";
import { LayoutError } from "@repo/world-generator/layout";
import { describe, expect, it, vi } from "vitest";

import { fixtureGraph } from "./fixture";
import { codeAreaStore } from "./module-areas";
import { toWorldGraph } from "./world-graph";

// The layout here cannot give `wide.ts`'s first hub more than `limit`
// doors, and on the seeds in `refused` cannot lay it out at all, so each
// rung of the hub-door ladder is pinned without hunting for a real module
// and seed that fail.
const layout = vi.hoisted(() => ({
  limit: 3,
  refused: new Set<number>(),
}));

vi.mock("@repo/world-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof WorldGenerator>();
  return {
    ...actual,
    generateWorld: (options: GenerateWorldOptions) => {
      const doors = options.graph.connections.filter(
        ({ from, to }) => from === "wide.ts" || to === "wide.ts"
      );
      const [first] = doors;
      if (
        first !== undefined &&
        (doors.length > layout.limit || layout.refused.has(options.seed))
      ) {
        throw new LayoutError(first);
      }
      return actual.generateWorld(options);
    },
  };
});

/** A module of twelve functions nobody calls: twelve doors off its hubs. */
const graph = () =>
  fixtureGraph(
    {
      path: "wide.ts",
      functions: Array.from({ length: 12 }, (_, index) => ({
        name: `f${index}`,
      })),
    },
    { path: "small.ts", functions: [{ name: "g" }] }
  );

const generate = (id: string, seed = 1) => {
  const result = codeAreaStore(graph(), seed, { variation: false }).ensure(id);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result.area;
};

const hubsOf = (rooms: readonly { readonly id: string }[]) =>
  rooms.filter(
    (room) => room.id.startsWith("wide.ts#") || room.id === "wide.ts"
  );

describe("toWorldGraph with maxDoors", () => {
  it("gives no hub more doors than asked, chain links included", () => {
    for (const maxDoors of [5, 4, 3]) {
      const world = toWorldGraph(
        graph(),
        new Set(),
        null,
        graph().modules[0],
        maxDoors
      );
      for (const hub of hubsOf(world.rooms)) {
        const doors = world.connections.filter(
          ({ from, to }) => from === hub.id || to === hub.id
        );
        expect(doors.length, `${maxDoors}: ${hub.id}`).toBeLessThanOrEqual(
          maxDoors
        );
      }
    }
  });
});

describe("the hub-door ladder", () => {
  it("steps down to smaller hubs, chaining more of them, until it fits", () => {
    layout.limit = 3;
    layout.refused = new Set();
    const area = generate("wide.ts");
    const planned = toWorldGraph(graph(), new Set(), null, graph().modules[0]);
    expect(hubsOf(area.graph.rooms).length).toBeGreaterThan(
      hubsOf(planned.rooms).length
    );
    expect(area.seed).toBe(1);
  });

  it("leaves a module that fits as it was", () => {
    layout.limit = 3;
    layout.refused = new Set();
    const small = graph().modules[1];
    expect(generate("small.ts").graph.rooms).toEqual(
      toWorldGraph(graph(), new Set(), null, small).rooms
    );
  });

  it("tries derived layout seeds on the last rung", () => {
    layout.limit = 3;
    layout.refused = new Set([1, 1 + 7919]);
    expect(generate("wide.ts").seed).toBe(1 + 2 * 7919);
  });

  it("fails the module once every rung and seed has failed", () => {
    layout.limit = 2;
    layout.refused = new Set();
    expect(() => generate("wide.ts")).toThrow("Could not lay out");
    expect(generate("small.ts").id).toBe("small.ts");
  });
});
