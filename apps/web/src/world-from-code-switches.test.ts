import type { GeneratedWorld } from "@repo/types";
import { describe, expect, it } from "vitest";

import { codeGraphOf, promptOf, worldFromCode } from "./world-from-code";

/** The flow rooms of a function, in flow order. */
const roomsOf = (world: GeneratedWorld, fnId: string) =>
  world.layout.rooms.filter((room) => room.cluster === fnId);

/** A north or south wall: one that runs along X. */
const acrossX = (wall: string | undefined) =>
  wall === "north" || wall === "south";

describe("switch fallthrough", () => {
  it("gives a case that falls through a side door into the next case", () => {
    const { codeGraph, error } = codeGraphOf("switches");
    if (codeGraph === null) {
      throw new Error(`switches: ${error}`);
    }
    const route = roomsOf(worldFromCode(codeGraph, 1), "switches.ts::route");
    expect(route[2]?.label).toBe("warnSuspended(…)");
    expect(route[3]?.label).toBe("if (isAppealing())");
    // `case "suspended"` falls through: a side door into `case "banned"`,
    // its call portal on the other wall.
    const suspended = route[2];
    const fallthrough = suspended?.doors.find(
      (candidate) => candidate.targetRoomId === route[3]?.id
    );
    expect(fallthrough).toMatchObject({
      lane: { kind: "case", text: 'case "banned"' },
      forward: true,
    });
    // A side door: across the flow, whichever way the cluster was turned,
    // so perpendicular to the door it was entered by from the switch head
    // (that side carries the lane without walking with it).
    const head = suspended?.doors.find(
      (candidate) =>
        candidate.lane !== undefined && candidate.forward === undefined
    );
    expect(head).toBeDefined();
    expect(acrossX(fallthrough?.wall)).toBe(!acrossX(head?.wall));
    expect(
      (suspended?.portals ?? []).map((portal) => portal.wall)
    ).not.toContain(fallthrough?.wall);
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: suspended?.id ?? "",
        targetRoomId: route[3]?.id ?? "",
        ...(fallthrough?.lane === undefined ? {} : { lane: fallthrough.lane }),
      })
    ).toBe('→ case "banned"');
  });
});
