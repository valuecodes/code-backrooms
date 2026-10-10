import { describe, expect, it } from "vitest";

import { checkAreas } from "./area-checks";
import { assembleAreas } from "./areas";
import { areaGraphs, areaWorld, portalGraph } from "./portal-world";
import { generateWorld } from "./world-generator";

describe("checkAreas", () => {
  it("passes three areas joined by call and module portals on every seed", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      expect(checkAreas(areaWorld(seed)), `seed ${seed}`).toEqual([]);
    }
  });

  it("names a room two areas share", () => {
    const world = generateWorld({ seed: 1, graph: portalGraph });
    const twice = assembleAreas(1, "a", [
      { id: "a", world },
      { id: "b", world },
    ]);
    expect(checkAreas(twice)).toEqual(
      expect.arrayContaining(["room hub is in more than one area"])
    );
  });

  it("names areas that stand too close", () => {
    const world = areaWorld();
    const [one, two, three] = world.areas;
    if (one === undefined || two === undefined || three === undefined) {
      throw new Error("Expected three areas");
    }
    const close = {
      ...world,
      areas: [one, { ...two, bounds: one.bounds }, three],
    };
    expect(checkAreas(close)).toEqual(
      expect.arrayContaining(["areas one and two are closer than 32 m"])
    );
  });

  it("names a portal into a unit no area has", () => {
    const world = areaWorld();
    const areaOf = new Map(
      [...world.areaOf].filter(([unit]) => unit !== "work")
    );
    expect(checkAreas({ ...world, areaOf })).toEqual(
      expect.arrayContaining([
        "portal portal:main>work leads to unknown unit work",
      ])
    );
  });

  it("names an area no placed portal reaches", () => {
    const [, two, three] = areaGraphs;
    if (two === undefined || three === undefined) {
      throw new Error("Expected three area graphs");
    }
    const world = assembleAreas(
      1,
      "one",
      [["one", portalGraph] as const, two, three].map(([id, graph]) => ({
        id,
        world: generateWorld({
          seed: 1,
          graph,
          corridorPrefix: `${id}/corridor-`,
        }),
      }))
    );
    expect(checkAreas(world)).toEqual(
      expect.arrayContaining([
        "area two is unreachable from one",
        "area three is unreachable from one",
      ])
    );
  });
});
