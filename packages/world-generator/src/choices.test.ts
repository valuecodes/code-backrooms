import type { ClusterPortal, Portal, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { cluster, clusterGraph } from "./cluster-world";
import { validateGraph } from "./graph";
import { inAnyTrigger, nearestTarget, portalToEnter } from "./interaction";
import { createNavigator } from "./navigation";
import type { NavigationState } from "./navigation";
import { generateWorld } from "./world-generator";

const CHOICE: ClusterPortal = {
  id: "choice:fn@5",
  kind: "choice",
  roomId: "step",
  wall: "east",
  along: 2,
  label: "choose",
  candidates: ["callee", "other"],
};

const GRAPH_CHOICE: Portal = {
  id: "choice:fn@5",
  kind: "choice",
  from: "step",
  to: "step",
  label: "choose",
  candidates: ["callee", "other"],
};

/** The cluster graph with one more cluster portal and one more graph portal. */
const chosen = (
  clusterPortal: ClusterPortal | null = CHOICE,
  portal: Portal | null = GRAPH_CHOICE,
  external: readonly string[] = []
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
  ...(external.length > 0 ? { external } : {}),
});

const withCandidates = (candidates: readonly string[]) =>
  chosen(
    { ...CHOICE, candidates },
    { ...GRAPH_CHOICE, candidates },
    candidates.filter(
      (id) => !clusterGraph.rooms.some((room) => room.id === id)
    )
  );

describe("validateGraph choices", () => {
  it("accepts a choice its cluster placed, on and to its own room", () => {
    expect(() => validateGraph(chosen())).not.toThrow();
  });

  it("accepts a candidate of another area", () => {
    expect(() =>
      validateGraph(withCandidates(["callee", "far"]))
    ).not.toThrow();
  });

  it("rejects a choice leading anywhere but its own room", () => {
    expect(() =>
      validateGraph(chosen(CHOICE, { ...GRAPH_CHOICE, to: "callee" }))
    ).toThrow(/references an unknown room/);
  });

  it("rejects one candidate, ten, a repeat or an unknown one", () => {
    const tooMany = Array.from({ length: 10 }, (_, index) => `far${index}`);
    for (const candidates of [["callee"], tooMany, ["callee", "callee"]]) {
      expect(() => validateGraph(withCandidates(candidates))).toThrow(
        /must offer 2 to 9 distinct known units/
      );
    }
    expect(() =>
      validateGraph(
        chosen(
          { ...CHOICE, candidates: ["callee", "nowhere"] },
          { ...GRAPH_CHOICE, candidates: ["callee", "nowhere"] }
        )
      )
    ).toThrow(/must offer 2 to 9 distinct known units/);
  });

  it("rejects a cluster choice that is not placed or has a target", () => {
    expect(() =>
      validateGraph(
        chosen({
          id: CHOICE.id,
          kind: "choice",
          roomId: "step",
          candidates: ["callee", "other"],
        })
      )
    ).toThrow(/must be placed by its cluster and have no target/);
    expect(() =>
      validateGraph(chosen({ ...CHOICE, target: "callee" }))
    ).toThrow(/must be placed by its cluster and have no target/);
  });

  it("never lets a choice and a marker stand in for each other", () => {
    expect(() => validateGraph(chosen({ ...CHOICE, kind: "marker" }))).toThrow(
      /does not match its cluster's (?:marker|choice)/
    );
    expect(() =>
      validateGraph(
        chosen(CHOICE, {
          id: GRAPH_CHOICE.id,
          kind: "marker",
          from: "step",
          to: "step",
        })
      )
    ).toThrow(/does not match its cluster's (?:marker|choice)/);
  });

  it("rejects candidates on any other kind of portal", () => {
    expect(() =>
      validateGraph(
        chosen(null, {
          id: "portal:fn@9",
          kind: "call",
          from: "call",
          to: "callee",
          candidates: ["callee", "other"],
        })
      )
    ).toThrow(/only a choice does/);
  });
});

describe("a laid out choice", () => {
  const world = generateWorld({ seed: 1, graph: chosen() });
  const built = world.built.portals.find(
    ({ portal }) => portal.id === CHOICE.id
  );
  if (built === undefined) {
    throw new Error("choice not built");
  }
  const intoWall = { x: -built.normal.x, z: -built.normal.z };
  const position = {
    x: (built.trigger.minX + built.trigger.maxX) / 2,
    z: (built.trigger.minZ + built.trigger.maxZ) / 2,
  };
  const navigator = createNavigator(world);
  const inFn: NavigationState = { frames: [], roomId: "fn" };

  it("is placed with its candidates, never walked into and never disarms the portals", () => {
    expect(world.layout.unplacedPortals).toEqual([]);
    expect(built.portal.candidates).toEqual(["callee", "other"]);
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
    expect(
      navigator.step(inFn, { type: "portal", portalId: CHOICE.id })
    ).toEqual({ state: inFn, teleport: null });
  });

  it("is prompted from in front of it", () => {
    expect(
      nearestTarget(world.built, "step", {
        position: {
          x: position.x + built.normal.x,
          z: position.z + built.normal.z,
        },
        forward: intoWall,
        velocity: { x: 0, z: 0 },
      })
    ).toEqual({ kind: "portal", portalId: CHOICE.id });
  });

  it("enters a picked candidate with a frame and returns to the portal", () => {
    const entered = navigator.step(inFn, {
      type: "choose",
      portalId: CHOICE.id,
      calleeId: "other",
    });
    expect(entered.state).toEqual({
      frames: [
        {
          portalId: CHOICE.id,
          callerRoomId: "fn",
          calleeRoomId: "other",
          returnTo: built.returnPoint,
        },
      ],
      roomId: "other",
    });
    expect(entered.teleport).toEqual(world.built.entries.get("other"));
    const back = navigator.step(entered.state, { type: "back" });
    expect(back).toEqual({
      state: { frames: [], roomId: "fn" },
      teleport: built.returnPoint,
    });
  });

  it("ignores a second pick made before the first one landed", () => {
    const { state } = navigator.step(inFn, {
      type: "choose",
      portalId: CHOICE.id,
      calleeId: "callee",
    });
    expect(
      navigator.step(state, {
        type: "choose",
        portalId: CHOICE.id,
        calleeId: "other",
      })
    ).toEqual({ state, teleport: null });
  });

  it("stays put for a candidate not offered or for another portal", () => {
    for (const event of [
      { type: "choose", portalId: CHOICE.id, calleeId: "hub" },
      { type: "choose", portalId: "return:fn", calleeId: "callee" },
      { type: "choose", portalId: "nowhere", calleeId: "callee" },
    ] as const) {
      expect(navigator.step(inFn, event)).toEqual({
        state: inFn,
        teleport: null,
      });
    }
  });

  it("stays put for a candidate whose area was never joined", () => {
    const far = generateWorld({
      seed: 1,
      graph: withCandidates(["callee", "far"]),
    });
    expect(
      createNavigator(far).step(inFn, {
        type: "choose",
        portalId: CHOICE.id,
        calleeId: "far",
      })
    ).toEqual({ state: inFn, teleport: null });
  });
});
