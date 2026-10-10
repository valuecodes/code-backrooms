import type { ClusterPortal, Portal, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { cluster, clusterGraph } from "./cluster-world";
import { validateGraph } from "./graph";
import { inAnyTrigger, nearestTarget, portalToEnter } from "./interaction";
import { createNavigator } from "./navigation";
import { generateWorld } from "./world-generator";

const MARKER: ClusterPortal = {
  id: "marker:step",
  kind: "marker",
  roomId: "step",
  wall: "east",
  along: 2,
  label: "1 call",
};

const GRAPH_MARKER: Portal = {
  id: "marker:step",
  kind: "marker",
  from: "step",
  to: "step",
  label: "1 call",
};

/** The cluster graph with one more cluster portal and one more graph portal. */
const marked = (
  clusterPortal: ClusterPortal | null = MARKER,
  portal: Portal | null = GRAPH_MARKER
): WorldGraph => ({
  ...clusterGraph,
  rooms: clusterGraph.rooms.map((room) =>
    room.id === "fn"
      ? {
          ...room,
          cluster: {
            ...cluster,
            portals: [
              ...cluster.portals,
              ...(clusterPortal === null ? [] : [clusterPortal]),
            ],
          },
        }
      : room
  ),
  portals: [
    ...(clusterGraph.portals ?? []),
    ...(portal === null ? [] : [portal]),
  ],
});

describe("validateGraph markers", () => {
  it("accepts a marker its cluster placed, on and to its own room", () => {
    expect(() => validateGraph(marked())).not.toThrow();
  });

  it("rejects a marker leading anywhere else or off a cluster", () => {
    expect(() =>
      validateGraph(marked(MARKER, { ...GRAPH_MARKER, to: "hub" }))
    ).toThrow(/references an unknown room/);
    expect(() =>
      validateGraph(
        marked(null, {
          ...GRAPH_MARKER,
          id: "marker:hub",
          from: "hub",
          to: "hub",
        })
      )
    ).toThrow(/references an unknown room/);
  });

  it("rejects a cluster marker that is not placed or has a target", () => {
    expect(() =>
      validateGraph(
        marked({ id: "marker:step", kind: "marker", roomId: "step" })
      )
    ).toThrow(/must be placed by its cluster and lead nowhere/);
    expect(() =>
      validateGraph(marked({ ...MARKER, target: "callee" }))
    ).toThrow(/must be placed by its cluster and lead nowhere/);
  });

  it("never lets a marker and a call portal stand in for each other", () => {
    expect(() =>
      validateGraph(marked({ ...MARKER, kind: "call", target: "callee" }))
    ).toThrow(/does not match its cluster's marker/);
    expect(() =>
      validateGraph(
        marked(MARKER, { ...GRAPH_MARKER, kind: "call", to: "callee" })
      )
    ).toThrow(/does not match its cluster's marker/);
  });
});

describe("a laid out marker", () => {
  const world = generateWorld({ seed: 1, graph: marked() });
  const built = world.built.portals.find(
    ({ portal }) => portal.id === MARKER.id
  );
  if (built === undefined) {
    throw new Error("marker not built");
  }
  const intoWall = { x: -built.normal.x, z: -built.normal.z };
  const position = {
    x: (built.trigger.minX + built.trigger.maxX) / 2,
    z: (built.trigger.minZ + built.trigger.maxZ) / 2,
  };

  it("is placed, never entered and never disarms the portals", () => {
    expect(world.layout.unplacedPortals).toEqual([]);
    expect(
      portalToEnter(
        world.built.portals,
        {
          position,
          forward: intoWall,
          velocity: { x: intoWall.x * 2, z: intoWall.z * 2 },
        },
        true
      )
    ).toBeNull();
    expect(inAnyTrigger(world.built.portals, position)).toBe(false);
  });

  it("is still prompted, and stepping into it goes nowhere", () => {
    const back = {
      x: position.x + built.normal.x,
      z: position.z + built.normal.z,
    };
    expect(
      nearestTarget(world.built, "step", {
        position: back,
        forward: intoWall,
        velocity: { x: 0, z: 0 },
      })
    ).toEqual({ kind: "portal", portalId: MARKER.id });
    const navigator = createNavigator(world);
    const state = { frames: [], roomId: "fn" };
    expect(
      navigator.step(state, { type: "portal", portalId: MARKER.id })
    ).toEqual({ state, teleport: null });
  });
});
