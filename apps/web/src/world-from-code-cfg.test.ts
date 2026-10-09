import { cfgOf } from "@repo/code-graph/cfg";
import { cfgFailures, cfgLayoutFailures } from "@repo/code-graph/cfg-checks";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { ExampleName } from "./examples";
import { codeGraphOf, worldFromCode } from "./world-from-code";

const exampleNames = Object.keys(examples) as readonly ExampleName[];

describe("worldFromCode and the control-flow graph", () => {
  it.each(exampleNames)(
    "keeps every function of the %s example on its control-flow graph",
    (name) => {
      const { codeGraph, error } = codeGraphOf(name);
      if (codeGraph === null) {
        throw new Error(`${name}: ${error}`);
      }
      const world = worldFromCode(codeGraph, 1);
      const failures = codeGraph.functions.flatMap((fn) => {
        const cluster = world.graph.rooms.find(
          (room) => room.id === fn.id
        )?.cluster;
        const cfg = cfgOf(fn);
        return [
          ...cfgFailures(fn, cfg),
          ...(cluster === undefined
            ? ["no cluster"]
            : cfgLayoutFailures(fn, cfg, cluster)),
        ].map((failure) => `${fn.id}: ${failure}`);
      });
      expect(codeGraph.functions.length).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    }
  );
});
