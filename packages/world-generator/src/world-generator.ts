import type { GeneratedWorld, WorldGraph } from "@repo/types";

import { buildWorld } from "./geometry";
import { generateGraph } from "./graph";
import { generateLayout } from "./layout";

type GenerateWorldOptions = {
  readonly seed: number;
  /** Rooms in the random graph; ignored when `graph` is given. */
  readonly roomCount?: number;
  /** An externally supplied graph, for example from a control-flow analysis. */
  readonly graph?: WorldGraph;
};

const DEFAULT_ROOM_COUNT = 15;

/**
 * A random graph that the layout cannot pack (well under 1 % of seeds) is
 * replaced by the next one derived from the seed, so the result stays a pure
 * function of the options. Supplied graphs are never swapped: they throw.
 */
const GRAPH_ATTEMPTS = 4;

/**
 * Graph -> layout -> built geometry. The same seed and options always give
 * the same world; nothing here touches `Math.random()`.
 */
const generateWorld = ({
  seed,
  roomCount = DEFAULT_ROOM_COUNT,
  graph,
}: GenerateWorldOptions): GeneratedWorld => {
  const attempts = graph === undefined ? GRAPH_ATTEMPTS : 1;
  for (let attempt = 0; ; attempt += 1) {
    const source =
      graph ?? generateGraph({ seed: seed + attempt * 7919, roomCount });
    try {
      const layout = generateLayout(source, seed);
      return { seed, graph: source, layout, built: buildWorld(layout) };
    } catch (error) {
      if (attempt + 1 >= attempts) {
        throw error;
      }
    }
  }
};

export { DEFAULT_ROOM_COUNT, generateWorld };
export type { GenerateWorldOptions };
