import type { RoomCluster, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { cluster, clusterGraph } from "./cluster-world";
import { validateGraph } from "./graph";

/** The cluster graph with `fn`'s cluster replaced. */
const withCluster = (
  patch: Partial<RoomCluster>,
  extra: Partial<WorldGraph> = {}
): WorldGraph => ({
  ...clusterGraph,
  ...extra,
  rooms: clusterGraph.rooms.map((room) =>
    room.id === "fn" ? { ...room, cluster: { ...cluster, ...patch } } : room
  ),
});

describe("validateGraph jump portals", () => {
  it("lets a jump portal lead only to a room of its own cluster, and count as a way in", () => {
    const jump = { id: "jump:call", kind: "jump", roomId: "call" } as const;
    const graphJump = (to: string) => ({
      portals: [
        ...(clusterGraph.portals ?? []),
        { id: jump.id, kind: "jump" as const, from: "call", to },
      ],
    });
    // Without its door the return room is reached through the jump alone.
    const jumping = (target: string, to: string) =>
      withCluster(
        {
          doors: cluster.doors.slice(0, 1),
          portals: [...cluster.portals, { ...jump, target }],
        },
        graphJump(to)
      );
    expect(() => validateGraph(jumping("ret", "ret"))).not.toThrow();
    expect(() => validateGraph(jumping("hub", "ret"))).toThrow(
      /must lead to a room of "fn"/
    );
    expect(() => validateGraph(jumping("ret", "hub"))).toThrow(
      /references an unknown room/
    );
    expect(() => validateGraph(jumping("ret", "other"))).toThrow(
      /references an unknown room/
    );
    // The graph's jump must lead where the cluster's does.
    expect(() => validateGraph(jumping("ret", "step"))).toThrow(
      /does not match its cluster's jump portal/
    );
    expect(() =>
      validateGraph(
        withCluster(
          {},
          {
            portals: [
              ...(clusterGraph.portals ?? []),
              { id: "jump:call", kind: "jump", from: "call", to: "ret" },
            ],
          }
        )
      )
    ).toThrow(/does not match its cluster's jump portal/);
  });
});
