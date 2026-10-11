import type * as WorldGenerator from "@repo/world-generator";
import type { GenerateWorldOptions } from "@repo/world-generator";
import { describe, expect, it, vi } from "vitest";

import { fixtureGraph } from "./fixture";
import { codeAreaStore, generateCodeWorld } from "./module-areas";

// A module that cannot be laid out is rare and seed-dependent; here
// `broken.ts` always fails, so what the eager API does with it is pinned.
vi.mock("@repo/world-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof WorldGenerator>();
  return {
    ...actual,
    generateWorld: (options: GenerateWorldOptions) => {
      if (
        options.graph?.rooms.some((room) => room.id === "broken.ts") === true
      ) {
        throw new Error("no room for broken.ts");
      }
      return actual.generateWorld(options);
    },
  };
});

const graph = () =>
  fixtureGraph(
    { path: "broken.ts", functions: [{ name: "f" }] },
    { path: "fine.ts", functions: [{ name: "g" }] }
  );

describe("a module that cannot be generated", () => {
  it("throws from generateCodeWorld instead of leaving the module out", () => {
    expect(() => generateCodeWorld(graph(), 1)).toThrow(
      "Module broken.ts could not be generated: Error: no room for broken.ts"
    );
  });

  it("is kept as an error and listed as failed by an eager store", () => {
    const { world, errors } = codeAreaStore(graph(), 1, {
      eager: true,
    }).snapshot();
    expect(world.failed).toEqual(["broken.ts"]);
    expect(world.pending).toEqual([]);
    expect(errors.get("broken.ts")).toContain("no room for broken.ts");
    expect(world.areas.map((area) => area.id)).toContain("fine.ts");
  });
});
