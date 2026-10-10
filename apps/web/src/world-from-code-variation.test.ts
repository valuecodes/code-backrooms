import { generateCodeWorld } from "@repo/code-graph/module-areas";
import type { GeneratedWorld } from "@repo/types";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { ExampleName } from "./examples";
import { codeGraphOf } from "./world-from-code";

const exampleNames = Object.keys(examples) as readonly ExampleName[];

/**
 * What is connected, as sorted lines: cluster doors, connections the layout
 * realised and portals it placed. Variation may never change any of it.
 */
const connectivity = (world: GeneratedWorld): readonly string[] => {
  const unresolved = new Set(
    world.layout.unresolved.map(({ from, to }) => `${from}|${to}`)
  );
  const unplaced = new Set(world.layout.unplacedPortals.map(({ id }) => id));
  return [
    ...world.graph.rooms.flatMap((room) =>
      (room.cluster?.doors ?? []).map(
        (door) =>
          `door|${room.id}|${door.from}|${door.to}|${door.lane?.kind ?? ""}|${door.opening ?? ""}`
      )
    ),
    ...world.graph.connections
      .filter(({ from, to }) => !unresolved.has(`${from}|${to}`))
      .map(({ from, to, kind }) => `connection|${from}|${to}|${kind ?? ""}`),
    ...(world.graph.portals ?? [])
      .filter(({ id }) => !unplaced.has(id))
      .map(({ id, kind, from, to }) => `portal|${id}|${kind}|${from}|${to}`),
  ].toSorted();
};

describe("aesthetic variation", () => {
  it.each(exampleNames)(
    "connects the %s example the same with variation on and off",
    (name) => {
      const { codeGraph, error } = codeGraphOf(name);
      if (codeGraph === null) {
        throw new Error(`${name}: ${error}`);
      }
      for (let seed = 1; seed <= 10; seed += 1) {
        const on = generateCodeWorld(codeGraph, seed);
        const off = generateCodeWorld(codeGraph, seed, { variation: false });
        expect(on.areas.map(connectivity), `seed ${seed}`).toEqual(
          off.areas.map(connectivity)
        );
      }
    }
  );
});
