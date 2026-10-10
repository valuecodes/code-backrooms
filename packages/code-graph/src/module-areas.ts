import type { AreaWorld, GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { assembleAreas } from "@repo/world-generator/areas";
import { LayoutError } from "@repo/world-generator/layout";

import type { CodeGraph, ModuleNode } from "./code-graph";
import { moduleLinks } from "./module-links";
import { edgeKey, toWorldGraph } from "./world-graph";

/** How one module's area is laid out. */
type AreaInput = {
  readonly graph: CodeGraph;
  readonly module: ModuleNode;
  readonly seed: number;
  /** Modules the hub also gets a module portal to. */
  readonly extraLinks: readonly string[];
};

/** Ids of what a layout left out: unresolved connections, unplaced portals. */
const gapsOf = ({ layout }: GeneratedWorld): string =>
  JSON.stringify([
    ...layout.unresolved.map(({ from, to }) => `${from}->${to}`).toSorted(),
    ...layout.unplacedPortals.map(({ id }) => id).toSorted(),
  ]);

/** One module's world: varied when `varied`, its corridors named after the module. */
const layOut = (
  { graph, module, seed, extraLinks }: AreaInput,
  portalOnly: ReadonlySet<string>,
  varied: boolean
): GeneratedWorld =>
  generateWorld({
    seed,
    graph: toWorldGraph(
      graph,
      portalOnly,
      varied ? seed : null,
      module,
      extraLinks
    ),
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
 * The modules nobody imports first, then the rest (only cycles reach
 * those), each group in module order.
 */
const rootsFirst = (graph: CodeGraph): readonly ModuleNode[] => {
  const imported = new Set(
    graph.modules.flatMap((module) => moduleLinks(graph, module))
  );
  return [
    ...graph.modules.filter((module) => !imported.has(module.id)),
    ...graph.modules.filter((module) => imported.has(module.id)),
  ];
};

/**
 * Modules the entry cannot reach by following imports, so that its hub
 * gets a module portal to them: roots first, each one only if no earlier
 * one already leads there.
 */
const straysFrom = (graph: CodeGraph, entry: ModuleNode): readonly string[] => {
  const byId = new Map(graph.modules.map((module) => [module.id, module]));
  const reached = new Set<string>();
  const reach = (id: string) => {
    const queue = [id];
    reached.add(id);
    // for...of sees ids pushed while iterating, so this is a plain BFS.
    for (const current of queue) {
      const module = byId.get(current);
      for (const next of module === undefined
        ? []
        : moduleLinks(graph, module)) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
  };
  reach(entry.id);
  const strays: string[] = [];
  for (const module of rootsFirst(graph)) {
    if (!reached.has(module.id)) {
      strays.push(module.id);
      reach(module.id);
    }
  }
  return strays;
};

/**
 * The code graph as areas, one per module, each laid out on its own and set
 * apart from the others, joined by module and call portals. The entry is
 * the first module nobody imports; its hub also leads to every module the
 * imports from it do not reach, so every area can be walked to.
 */
const generateCodeWorld = (
  graph: CodeGraph,
  seed: number,
  { variation = true }: { readonly variation?: boolean } = {}
): AreaWorld => {
  // The first module nobody imports, or the first one when all are (a cycle).
  const entry = rootsFirst(graph)[0];
  if (entry === undefined) {
    throw new Error("A code graph needs at least one module");
  }
  const strays = straysFrom(graph, entry);
  return assembleAreas(
    seed,
    entry.id,
    graph.modules.map((module) => ({
      id: module.id,
      world: moduleArea(
        {
          graph,
          module,
          seed,
          extraLinks: module === entry ? strays : [],
        },
        variation
      ),
    }))
  );
};

export { generateCodeWorld };
