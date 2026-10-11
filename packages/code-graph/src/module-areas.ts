import type { AreaWorld, GeneratedWorld, WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { createAreaStore } from "@repo/world-generator/area-store";
import type { AreaSpec, AreaStore } from "@repo/world-generator/area-store";
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

type CodeAreaOptions = {
  readonly variation?: boolean;
  /** Generate every module at once rather than when first asked for. */
  readonly eager?: boolean;
};

/** The ids of a graph's rooms: the units an area will have. */
const unitsOf = ({ rooms }: WorldGraph): readonly string[] =>
  rooms.map((room) => room.id);

/**
 * The repository entrance, then one area per module. A module's units come
 * from its world graph alone, which is cheap: demoting a call door to a
 * portal and varying proportions change no room, so they are known before
 * the module is laid out.
 */
const codeAreaSpecs = (
  graph: CodeGraph,
  seed: number,
  variation: boolean
): readonly AreaSpec[] => {
  const entrance = entranceGraph(graph, entryModules(graph));
  return [
    {
      id: ENTRANCE_ID,
      units: unitsOf(entrance),
      generate: () =>
        generateWorld({
          seed,
          graph: entrance,
          variation: false,
          corridorPrefix: `${ENTRANCE_ID}/corridor-`,
        }),
    },
    ...graph.modules.map((module): AreaSpec => ({
      id: module.id,
      units: unitsOf(toWorldGraph(graph, new Set(), null, module)),
      generate: () => moduleArea({ graph, module, seed }, variation),
    })),
  ];
};

/**
 * The code graph as areas: the repository entrance, then one per module,
 * each laid out on its own and set apart from the others, joined by module
 * and call portals. The player starts in the entrance, whose module portals
 * lead to the entry modules (`entryModules`), from which imports reach
 * every other module. Only the entrance is generated up front unless
 * `eager`; every module waits for its first `ensure`.
 */
const codeAreaStore = (
  graph: CodeGraph,
  seed: number,
  { variation = true, eager = false }: CodeAreaOptions = {}
): AreaStore => {
  if (graph.modules.length === 0) {
    throw new Error("A code graph needs at least one module");
  }
  const store = createAreaStore({
    seed,
    entry: ENTRANCE_ID,
    specs: codeAreaSpecs(graph, seed, variation),
  });
  if (eager) {
    store.ensureAll();
  }
  return store;
};

/**
 * Every area of the code graph at once: the entrance, then the modules in
 * order. Throws the first module that could not be laid out, rather than
 * returning a world without it; a store keeps such errors instead.
 */
const generateCodeWorld = (
  graph: CodeGraph,
  seed: number,
  { variation = true }: { readonly variation?: boolean } = {}
): AreaWorld => {
  const { world, errors } = codeAreaStore(graph, seed, {
    variation,
    eager: true,
  }).snapshot();
  const [failure] = errors;
  if (failure !== undefined) {
    const [module, message] = failure;
    throw new Error(`Module ${module} could not be generated: ${message}`);
  }
  return world;
};

export { codeAreaStore, generateCodeWorld };
