import { parseFlowNodeId } from "@repo/code-graph/ids";
import { createNavigator } from "@repo/world-generator/navigation";
import type { Frame, NavigationState } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { breadcrumbOf, codeGraphOf, worldFromCode } from "./world-from-code";

const portals = () => {
  const { codeGraph, error } = codeGraphOf(examples.portals);
  if (codeGraph === null) {
    throw new Error(`portals: ${error}`);
  }
  return codeGraph;
};

const fn = (name: string) => `portals.ts::${name}`;

const frame = (callerRoomId: string, calleeRoomId: string): Frame => ({
  portalId: null,
  callerRoomId,
  calleeRoomId,
  returnTo: { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } },
});

/** The frames of a call stack that walked `names` in order, ending in the last. */
const stackOf = (names: readonly string[]) => {
  const ids = names.map(fn);
  return {
    frames: ids.slice(1).map((id, index) => frame(ids[index] ?? "", id)),
    roomId: ids.at(-1) ?? null,
  };
};

const crumbOf = (names: readonly string[]) => {
  const { frames, roomId } = stackOf(names);
  return breadcrumbOf(portals(), frames, roomId);
};

/** The function a portal's room belongs to. */
const ownerOf = (roomId: string): string =>
  parseFlowNodeId(roomId)?.functionId ?? roomId;

describe("breadcrumbOf", () => {
  it("collapses direct recursion into one entry", () => {
    expect(crumbOf(["main", "countdown", "countdown", "countdown"])).toBe(
      "main() → countdown() ×3 ↻"
    );
  });

  it("keeps mutual recursion spelled out", () => {
    expect(crumbOf(["load", "format", "load", "format"])).toBe(
      "load() → format() → load() → format()"
    );
  });

  it("keeps the first caller and the last four of a long stack", () => {
    expect(
      crumbOf(["main", "load", "format", "render", "format", "load", "format"])
    ).toBe("main() → … → render() → format() → load() → format()");
    // A run is one entry: six entries, one of them ×3, stay whole.
    expect(
      crumbOf([
        "main",
        "load",
        "format",
        "format",
        "format",
        "render",
        "format",
        "load",
      ])
    ).toBe("main() → load() → format() ×3 ↻ → render() → format() → load()");
  });

  it("follows a walk through countdown's recursive portal", () => {
    const codeGraph = portals();
    const world = worldFromCode(codeGraph, 1);
    const navigator = createNavigator(world);
    const crumb = (state: NavigationState) =>
      breadcrumbOf(codeGraph, state.frames, state.roomId);
    const firstRoomOf = (fnId: string) =>
      world.layout.rooms.find((room) => room.cluster === fnId)?.id ?? null;

    // main → countdown is a call door: walking through it pushes a frame.
    const inMain = navigator.step(navigator.initial, {
      type: "room",
      roomId: firstRoomOf(fn("main")),
    }).state;
    const inCountdown = navigator.step(inMain, {
      type: "room",
      roomId: firstRoomOf(fn("countdown")),
    }).state;
    expect(crumb(inCountdown)).toBe("main() → countdown()");

    const self = world.built.portals.find(
      ({ portal }) =>
        portal.kind === "call" &&
        ownerOf(portal.from) === fn("countdown") &&
        ownerOf(portal.to) === fn("countdown")
    );
    expect(self).toBeDefined();
    const enter = { type: "portal", portalId: self?.portal.id ?? "" } as const;
    const once = navigator.step(inCountdown, enter).state;
    const twice = navigator.step(once, enter).state;
    expect(crumb(twice)).toBe("main() → countdown() ×3 ↻");

    const back = navigator.step(twice, { type: "back" }).state;
    expect(crumb(back)).toBe("main() → countdown() ×2 ↻");
  });
});
