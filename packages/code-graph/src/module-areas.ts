import type { AreaWorld, GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { assembleAreas } from "@repo/world-generator/areas";
import { LayoutError } from "@repo/world-generator/layout";

import type { CodeGraph, ModuleNode } from "./code-graph";
import { entranceGraph } from "./entrance";
import { entryModules } from "./entrypoints";
import { ENTRANCE_ID } from "./ids";
import { edgeKey, toWorldGraph } from "./world-graph";

/** How one module's area is laid out. */
type AreaInput = {
  readonly graph: CodeGraph;
  readonly module: ModuleNode;
  readonly seed: number;
};

/** Ids of what a layout left out: unresolved connections, unplaced portals. */
const gapsOf = ({ layout }: GeneratedWorld): string =>
  JSON.stringify([
    ...layout.unresolved.map(({ from, to }) => `${from}->${to}`).toSorted(),
    ...layout.unplacedPortals.map(({ id }) => id).toSorted(),
  ]);

/** One module's world: varied when `varied`, its corridors named after the module. */
const layOut = (
  { graph, module, seed }: AreaInput,
  portalOnly: ReadonlySet<string>,
  varied: boolean
): GeneratedWorld =>
  generateWorld({
    seed,
    graph: toWorldGraph(graph, portalOnly, varied ? seed : null, module),
    variation: varied,
    corridorPrefix: `${module.id}/corridor-`,
  });

type Plain = {
  readonly world: GeneratedWorld;
  /** The call edges demoted to portals, which fix the door/portal plan. */
  readonly portalOnly: ReadonlySet<string>;
};

/**
 * The plain world: a call door the layout cannot place is demoted to a
 * portal and the layout tried again, until everything fits.
 */
const plainWorld = (input: AreaInput): Plain => {
  const portalOnly = new Set<string>();
  for (;;) {
    try {
      return { world: layOut(input, portalOnly, false), portalOnly };
    } catch (error) {
      const failed =
        error instanceof LayoutError && error.connection.kind === "call"
          ? edgeKey(error.connection.from, error.connection.to)
          : null;
      if (failed === null || portalOnly.has(failed)) {
        throw error;
      }
      portalOnly.add(failed);
    }
  }
};

/**
 * One module laid out; the seed only changes the placement. A call door
 * the layout cannot place (a call inside a lane offers one wall only, and
 * that side may be taken) is demoted to a portal and the layout tried
 * again, so a module that parses always becomes an area: tree calls are
 * walkable where the walls allow, the rest teleport. `variation` lets the
 * seed vary proportions too: column and hub widths here, corridor widths in
 * the layout. Which calls are doors is decided on the plain world first and
 * kept; a varied layout that cannot realise exactly that plan gives way to
 * the plain world, so variation never changes what is connected.
 */
const moduleArea = (input: AreaInput, variation: boolean): GeneratedWorld => {
  const plain = plainWorld(input);
  if (!variation) {
    return plain.world;
  }
  try {
    const varied = layOut(input, plain.portalOnly, true);
    return gapsOf(varied) === gapsOf(plain.world) ? varied : plain.world;
  } catch (error) {
    if (error instanceof LayoutError) {
      return plain.world;
    }
    throw error;
  }
};

/**
 * The code graph as areas: the repository entrance first, then one per
 * module, each laid out on its own and set apart from the others, joined
 * by module and call portals. The player starts in the entrance, whose
 * module portals lead to the entry modules (`entryModules`), from which
 * imports reach every other module.
 */
const generateCodeWorld = (
  graph: CodeGraph,
  seed: number,
  { variation = true }: { readonly variation?: boolean } = {}
): AreaWorld => {
  if (graph.modules.length === 0) {
    throw new Error("A code graph needs at least one module");
  }
  const entrance = generateWorld({
    seed,
    graph: entranceGraph(graph, entryModules(graph)),
    variation: false,
    corridorPrefix: `${ENTRANCE_ID}/corridor-`,
  });
  return assembleAreas(seed, ENTRANCE_ID, [
    { id: ENTRANCE_ID, world: entrance },
    ...graph.modules.map((module) => ({
      id: module.id,
      world: moduleArea({ graph, module, seed }, variation),
    })),
  ]);
};

export { generateCodeWorld };
