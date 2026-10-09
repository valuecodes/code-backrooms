import type { GeneratedWorld, RoomCluster, WorldGraph } from "@repo/types";

import { generateWorld } from "./world-generator";

/**
 * A hand-written cluster for tests: a 4 x 9 column of three rooms (a step,
 * a call with a port on each side wall, a return with its portal), entered
 * through the step's north wall.
 */
const cluster: RoomCluster = {
  width: 4,
  depth: 9,
  entryRoomId: "step",
  rooms: [
    { id: "step", rect: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 }, role: "step" },
    {
      id: "call",
      rect: { minX: 0, maxX: 4, minZ: 4, maxZ: 7 },
      role: "call",
      label: "callee(…)",
    },
    { id: "ret", rect: { minX: 0, maxX: 4, minZ: 7, maxZ: 9 }, role: "return" },
  ],
  doors: [
    { from: "step", to: "call" },
    { from: "call", to: "ret" },
  ],
  ports: [
    { roomId: "step", wall: "north", lo: 0, hi: 4 },
    { roomId: "call", wall: "east", lo: 4, hi: 7, reservedFor: "callee" },
    { roomId: "call", wall: "west", lo: 4, hi: 7, reservedFor: "other" },
  ],
  portals: [
    { id: "return:fn", kind: "return", roomId: "ret", wall: "south", along: 2 },
  ],
};

/** A hub, the cluster off it, and a callee off each of the cluster's ports. */
const clusterGraph: WorldGraph = {
  rooms: [
    { id: "hub", width: 16, depth: 12, hub: true },
    { id: "fn", width: 4, depth: 9, cluster },
    { id: "callee", width: 5, depth: 5 },
    { id: "other", width: 5, depth: 5 },
  ],
  connections: [
    { from: "hub", to: "fn" },
    { from: "fn", to: "callee", kind: "call" },
    { from: "fn", to: "other", kind: "call" },
  ],
  portals: [
    {
      id: "return:fn",
      kind: "return",
      from: "ret",
      to: "hub",
      label: "return",
    },
  ],
  start: "hub",
};

/** The cluster graph laid out; throws if anything was left unrealised. */
const clusterWorld = (seed = 1): GeneratedWorld => {
  const world = generateWorld({ seed, graph: clusterGraph });
  if (
    world.layout.unresolved.length > 0 ||
    world.layout.unplacedPortals.length > 0
  ) {
    throw new Error(`Seed ${seed} did not realise the whole cluster graph`);
  }
  return world;
};

export { cluster, clusterGraph, clusterWorld };
