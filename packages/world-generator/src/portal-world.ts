import type { GeneratedWorld, WorldGraph } from "@repo/types";

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

export { portalGraph, portalWorld };
