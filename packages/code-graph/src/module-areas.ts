import type { AreaWorld, GeneratedWorld, WorldGraph } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { createAreaStore } from "@repo/world-generator/area-store";
import type { AreaSpec, AreaStore } from "@repo/world-generator/area-store";
import type { ZoneSpec } from "@repo/world-generator/areas";
import { LayoutError } from "@repo/world-generator/layout";

import { areaParentsOf } from "./area-parents";
import type { CodeGraph, ModuleNode } from "./code-graph";
import { entranceGraph } from "./entrance";
import { entryModules } from "./entrypoints";
import { HUB_DOOR_LADDER, MAX_HUB_DOORS } from "./hub-plan";
import { ENTRANCE_ID } from "./ids";
import { edgeKey, toWorldGraph } from "./world-graph";
import { zoneEntranceGraph, zoneGraph } from "./zone-graph";
import { hasZones, zoneOfModule, zonesOf } from "./zones";

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

/** Derived layout seeds tried on the last rung of HUB_DOOR_LADDER. */
const RESEEDS = 4;
const RESEED_STEP = 7919;

/** How a module is laid out: what the plain world settled on. */
type Plan = {
  /** The call edges demoted to portals, which fix the door/portal plan. */
  readonly portalOnly: ReadonlySet<string>;
  /** Doors per hub (`HUB_DOOR_LADDER`). */
  readonly maxDoors: number;
  /** The seed the plain layout searched with. */
  readonly layoutSeed: number;
};

/**
 * One module's world under `plan`: varied when `varied` (column and hub
 * widths from the module's own seed), its corridors named after the
 * module. The layout always searches with the plan's seed, so a module
 * the plain layout needed a derived seed for can still be varied.
 */
const layOut = (
  { graph, module, seed }: AreaInput,
  { portalOnly, maxDoors, layoutSeed }: Plan,
  varied: boolean
): GeneratedWorld =>
  generateWorld({
    seed: layoutSeed,
    graph: toWorldGraph(
      graph,
      portalOnly,
      varied ? seed : null,
      module,
      maxDoors
    ),
    variation: varied,
    corridorPrefix: `${module.id}/corridor-`,
  });

type Plain = Plan & { readonly world: GeneratedWorld };

/**
 * The plain world: a call door the layout cannot place is demoted to a
 * portal and the layout tried again. A hub or lobby door it cannot place
 * (or a call door already demoted) steps down HUB_DOOR_LADDER, chaining
 * smaller hubs, and the last rung tries a few derived layout seeds; only
 * when those fail too does the module fail.
 */
const plainWorld = (input: AreaInput): Plain => {
  const last = HUB_DOOR_LADDER.at(-1) ?? MAX_HUB_DOORS;
  const rungs = [
    ...HUB_DOOR_LADDER.map((maxDoors) => ({
      maxDoors,
      layoutSeed: input.seed,
    })),
    ...Array.from({ length: RESEEDS }, (_, k) => ({
      maxDoors: last,
      layoutSeed: input.seed + (k + 1) * RESEED_STEP,
    })),
  ];
  const portalOnly = new Set<string>();
  let rung = 0;
  for (;;) {
    const plan = {
      portalOnly,
      ...(rungs[rung] ?? { maxDoors: last, layoutSeed: input.seed }),
    };
    try {
      return { ...plan, world: layOut(input, plan, false) };
    } catch (error) {
      if (!(error instanceof LayoutError)) {
        throw error;
      }
      const failed =
        error.connection.kind === "call"
          ? edgeKey(error.connection.from, error.connection.to)
          : null;
      if (failed !== null && !portalOnly.has(failed)) {
        portalOnly.add(failed);
        continue;
      }
      rung += 1;
      if (rung >= rungs.length) {
        throw error;
      }
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
 * the layout. Which calls are doors, and how many doors a hub has, is
 * decided on the plain world first and kept; a varied layout that cannot realise exactly that plan gives way to
 * the plain world, so variation never changes what is connected.
 */
const moduleArea = (input: AreaInput, variation: boolean): GeneratedWorld => {
  const plain = plainWorld(input);
  if (!variation) {
    return plain.world;
  }
  try {
    const varied = layOut(input, plain, true);
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
 * A hub chain's area, the entrance's or a zone's: never varied, its
 * corridors named after its first hub.
 */
const hubArea = (seed: number, id: string, graph: WorldGraph): AreaSpec => ({
  id,
  units: unitsOf(graph),
  generate: () =>
    generateWorld({
      seed,
      graph,
      variation: false,
      corridorPrefix: `${id}/corridor-`,
    }),
});

/**
 * One area per module, in its zone when `zoned`. Its units come from its
 * world graph alone, which is cheap: demoting a call door to a portal and
 * varying proportions change no room, so they are known before the module
 * is laid out.
 */
const moduleSpecs = (
  graph: CodeGraph,
  seed: number,
  variation: boolean,
  zoned: boolean
): readonly AreaSpec[] =>
  graph.modules.map((module): AreaSpec => {
    const spec: AreaSpec = {
      id: module.id,
      units: unitsOf(toWorldGraph(graph, new Set(), null, module)),
      generate: () => moduleArea({ graph, module, seed }, variation),
    };
    const zone = zoned ? zoneOfModule(graph, module.id) : null;
    return zone === null ? spec : { ...spec, zone: zone.id };
  });

/** `codeAreaSpecs` before parents: what each area is and its zone. */
const zonedSpecs = (
  graph: CodeGraph,
  seed: number,
  variation: boolean
): readonly AreaSpec[] => {
  if (!hasZones(graph)) {
    return [
      hubArea(seed, ENTRANCE_ID, entranceGraph(graph, entryModules(graph))),
      ...moduleSpecs(graph, seed, variation, false),
    ];
  }
  const zones = zonesOf(graph);
  return [
    hubArea(seed, ENTRANCE_ID, zoneEntranceGraph(graph, zones)),
    ...zones.map((zone): AreaSpec => ({
      ...hubArea(seed, zone.id, zoneGraph(graph, zone)),
      zone: zone.id,
    })),
    ...moduleSpecs(graph, seed, variation, true),
  ];
};

/**
 * The repository entrance, then one area per zone's hub when there are
 * several zones, then one per module, each beside the area it is first
 * reached from (`areaParentsOf`). With one zone or none the entrance leads
 * straight to the entry modules and nothing is zoned.
 */
const codeAreaSpecs = (
  graph: CodeGraph,
  seed: number,
  variation: boolean
): readonly AreaSpec[] => {
  const parents = areaParentsOf(graph);
  return zonedSpecs(graph, seed, variation).map((spec) => {
    const parent = parents.get(spec.id);
    return parent === undefined ? spec : { ...spec, parent };
  });
};

/** Each zone with its hub area; none with one zone or none. */
const zoneSpecsOf = (graph: CodeGraph): readonly ZoneSpec[] =>
  hasZones(graph)
    ? zonesOf(graph).map((zone) => ({
        id: zone.id,
        name: zone.name,
        hub: zone.id,
      }))
    : [];

/**
 * The code graph as areas: the repository entrance, then one per module,
 * each laid out on its own and set apart from the others, joined by module
 * and call portals. The player starts in the entrance, whose module portals
 * lead to the entry modules (`entryModules`), from which imports reach
 * every other module. In a repository of several zones (`zonesOf`) they
 * lead to each zone's hub instead, whose portals lead to the zone's entry
 * modules. Each area is placed beside the one it is first reached from, so
 * the world grows out from the entrance in every direction, a branch per
 * zone. Only the entrance
 * is generated up front unless `eager`; every other area waits for its
 * first `ensure`.
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
    zones: zoneSpecsOf(graph),
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
