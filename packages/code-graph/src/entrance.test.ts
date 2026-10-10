import { generateWorld } from "@repo/world-generator";
import { validateGraph } from "@repo/world-generator/graph";
import { describe, expect, it } from "vitest";

import { entranceGraph, repositoryName } from "./entrance";
import { demoGraph, fixtureGraph } from "./fixture";
import { ENTRANCE_ID, modulePortalId } from "./ids";

/** A graph of `count` empty modules, `m0.ts` and on. */
const modulesGraph = (count: number) =>
  fixtureGraph(
    ...Array.from({ length: count }, (_, index) => ({
      path: `m${index}.ts`,
      functions: [],
    }))
  );

describe("entranceGraph", () => {
  it("is one hub with a module portal to each entry", () => {
    const graph = demoGraph();
    const world = entranceGraph(graph, graph.modules);
    expect(world.rooms).toEqual([
      expect.objectContaining({
        id: ENTRANCE_ID,
        label: "repository",
        hub: true,
      }),
    ]);
    expect(world.connections).toEqual([]);
    expect(world.portals).toEqual([
      {
        id: modulePortalId(ENTRANCE_ID, "demo.ts"),
        kind: "module",
        from: ENTRANCE_ID,
        to: "demo.ts",
        label: "demo.ts",
      },
    ]);
    expect(world.start).toBe(ENTRANCE_ID);
    expect(world.external).toEqual(["demo.ts"]);
    expect(() => validateGraph(world)).not.toThrow();
  });

  it("chains a second hub past eight entries", () => {
    const graph = modulesGraph(9);
    const world = entranceGraph(graph, graph.modules);
    const second = `${ENTRANCE_ID}#2`;
    expect(world.rooms.map((room) => room.id)).toEqual([ENTRANCE_ID, second]);
    expect(world.connections).toEqual([{ from: ENTRANCE_ID, to: second }]);
    const perHub = world.rooms.map(
      (room) =>
        (world.portals ?? []).filter((portal) => portal.from === room.id).length
    );
    expect(perHub).toEqual([8, 1]);
    expect(() => validateGraph(world)).not.toThrow();
    for (let seed = 1; seed <= 8; seed += 1) {
      const generated = generateWorld({ seed, graph: world });
      expect(generated.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
    }
  });

  it("keeps the order of the entries it is given", () => {
    const graph = modulesGraph(3);
    const [a, b, c] = graph.modules;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("Expected three modules");
    }
    const world = entranceGraph(graph, [c, a]);
    expect((world.portals ?? []).map((portal) => portal.to)).toEqual([
      "m2.ts",
      "m0.ts",
    ]);
    expect(world.external).toEqual(["m0.ts", "m2.ts"]);
  });
});

describe("repositoryName", () => {
  it("is the directory every module lies in", () => {
    expect(
      repositoryName(
        fixtureGraph(
          { path: "src/a.ts", functions: [] },
          { path: "src/b/c.ts", functions: [] }
        )
      )
    ).toBe("src");
    expect(
      repositoryName(
        fixtureGraph(
          { path: "pkg/src/a.ts", functions: [] },
          { path: "pkg/src/b/c.ts", functions: [] }
        )
      )
    ).toBe("pkg/src");
  });

  it("is `repository` when the modules share no directory", () => {
    expect(repositoryName(demoGraph())).toBe("repository");
    expect(
      repositoryName(
        fixtureGraph(
          { path: "src/a.ts", functions: [] },
          { path: "lib/b.ts", functions: [] }
        )
      )
    ).toBe("repository");
  });
});
