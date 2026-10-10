import type { AreaWorld, GeneratedWorld, WorldGraph } from "@repo/types";

import { assembleAreas } from "./areas";
import { generateWorld } from "./world-generator";

/**
 * A hand-written world for tests: a hub, a call chain of doors
 * (main -> login -> validate), a shared callee reached by a door from main
 * and a portal from login, a recursive portal, and a return portal in every
 * function room. Independent of @repo/code-graph, which would be a cycle.
 */
const portalGraph: WorldGraph = {
  rooms: [
    { id: "hub", width: 10, depth: 8, hub: true },
    { id: "main", width: 8, depth: 8 },
    { id: "login", width: 8, depth: 8 },
    { id: "validate", width: 6, depth: 6 },
    { id: "shared", width: 6, depth: 6 },
  ],
  connections: [
    { from: "hub", to: "main" },
    { from: "main", to: "login", kind: "call" },
    { from: "login", to: "validate", kind: "call" },
    { from: "main", to: "shared", kind: "call" },
  ],
  portals: [
    { id: "portal:login>shared", kind: "call", from: "login", to: "shared" },
    {
      id: "portal:validate>validate",
      kind: "call",
      from: "validate",
      to: "validate",
    },
    { id: "return:main", kind: "return", from: "main", to: "hub" },
    { id: "return:login", kind: "return", from: "login", to: "hub" },
    { id: "return:validate", kind: "return", from: "validate", to: "hub" },
    { id: "return:shared", kind: "return", from: "shared", to: "hub" },
  ],
  start: "hub",
};

/** The portal graph laid out; throws if anything was left unrealised. */
const portalWorld = (seed = 1): GeneratedWorld => {
  const world = generateWorld({ seed, graph: portalGraph });
  if (
    world.layout.unresolved.length > 0 ||
    world.layout.unplacedPortals.length > 0
  ) {
    throw new Error(`Seed ${seed} did not realise the whole portal graph`);
  }
  return world;
};

/**
 * Three areas for tests: the portal graph ("one") with a module portal to
 * a second hub and a call portal into a function there ("two"), which has
 * a module portal on to a third hub ("three") and one back to the first.
 */
const areaGraphs: readonly (readonly [string, WorldGraph])[] = [
  [
    "one",
    {
      ...portalGraph,
      portals: [
        ...(portalGraph.portals ?? []),
        { id: "module:hub>hub2", kind: "module", from: "hub", to: "hub2" },
        { id: "portal:main>work", kind: "call", from: "main", to: "work" },
      ],
      external: ["hub2", "work"],
    },
  ],
  [
    "two",
    {
      rooms: [
        { id: "hub2", width: 8, depth: 8, hub: true },
        { id: "work", width: 8, depth: 6 },
      ],
      connections: [{ from: "hub2", to: "work" }],
      portals: [
        { id: "module:hub2>hub", kind: "module", from: "hub2", to: "hub" },
        { id: "module:hub2>hub3", kind: "module", from: "hub2", to: "hub3" },
        { id: "return:work", kind: "return", from: "work", to: "hub2" },
      ],
      start: "hub2",
      external: ["hub", "hub3"],
    },
  ],
  [
    "three",
    {
      rooms: [{ id: "hub3", width: 6, depth: 6, hub: true }],
      connections: [],
      portals: [
        { id: "module:hub3>hub", kind: "module", from: "hub3", to: "hub" },
      ],
      external: ["hub"],
    },
  ],
];

/** The three areas laid out apart; throws if anything was left unrealised. */
const areaWorld = (seed = 1): AreaWorld =>
  assembleAreas(
    seed,
    "one",
    areaGraphs.map(([id, graph]) => {
      const world = generateWorld({
        seed,
        graph,
        corridorPrefix: `${id}/corridor-`,
      });
      if (
        world.layout.unresolved.length > 0 ||
        world.layout.unplacedPortals.length > 0
      ) {
        throw new Error(`Seed ${seed} did not realise area ${id}`);
      }
      return { id, world };
    })
  );

export { areaGraphs, areaWorld, portalGraph, portalWorld };
