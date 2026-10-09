import type { BuiltPortal, GeneratedWorld, Point } from "@repo/types";
import { describe, expect, it } from "vitest";

import { roomBounds } from "./geometry";
import { containsPoint } from "./locate";
import { createNavigator } from "./navigation";
import type { NavigationEvent, NavigationState, Navigator } from "./navigation";
import { portalWorld } from "./portal-world";

const world = portalWorld();
const navigator = createNavigator(world);

const room = (event: string | null): NavigationEvent => ({
  type: "room",
  roomId: event,
});
const portal = (portalId: string): NavigationEvent => ({
  type: "portal",
  portalId,
});

/** Runs the events in order, collecting every teleport. */
const run = (
  nav: Navigator,
  events: readonly NavigationEvent[],
  from: NavigationState = nav.initial
) => {
  const teleports: (Point | null)[] = [];
  let state = from;
  for (const event of events) {
    const step = nav.step(state, event);
    state = step.state;
    teleports.push(step.teleport?.position ?? null);
  }
  return { state, teleports };
};

const inRoom = (generated: GeneratedWorld, id: string, point: Point) => {
  const data = generated.layout.rooms.find((candidate) => candidate.id === id);
  return data !== undefined && containsPoint(roomBounds(data), point);
};

const builtPortal = (id: string): BuiltPortal => {
  const found = world.built.portals.find((item) => item.portal.id === id);
  if (found === undefined) {
    throw new Error(`No portal ${id}`);
  }
  return found;
};

describe("createNavigator", () => {
  it("pushes a frame per call door walked and pops them walking back", () => {
    const { state } = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
      room("validate"),
    ]);
    expect(state.roomId).toBe("validate");
    expect(state.frames.map((frame) => frame.calleeRoomId)).toEqual([
      "login",
      "validate",
    ]);
    expect(state.frames.every((frame) => frame.portalId === null)).toBe(true);
    const [first, second] = state.frames;
    expect(
      inRoom(world, "main", first?.returnTo.position ?? { x: 0, z: 0 })
    ).toBe(true);
    expect(
      inRoom(world, "login", second?.returnTo.position ?? { x: 0, z: 0 })
    ).toBe(true);

    const back = run(navigator, [room("login"), room("main")], state);
    expect(back.state.frames).toEqual([]);
    expect(back.teleports).toEqual([null, null]);
  });

  it("empties the stack on entering a hub and ignores corridors", () => {
    const corridorWorld = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((seed) => portalWorld(seed))
      .find((candidate) =>
        candidate.layout.rooms.some((data) => data.kind === "corridor")
      );
    expect(corridorWorld).toBeDefined();
    if (corridorWorld === undefined) {
      return;
    }
    const nav = createNavigator(corridorWorld);
    const corridor =
      corridorWorld.layout.rooms.find((data) => data.kind === "corridor")?.id ??
      "";
    const { state } = run(nav, [
      room("hub"),
      room("main"),
      room(corridor),
      room(null),
      room("login"),
    ]);
    expect(state.frames.map((frame) => frame.calleeRoomId)).toEqual(["login"]);
    const cleared = run(nav, [room("main"), room("hub")], {
      ...state,
      frames: [...state.frames, ...state.frames],
    });
    expect(cleared.state).toEqual({ frames: [], roomId: "hub" });
  });

  it("enters a call portal, lands inside the callee and returns to the portal", () => {
    const atLogin = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
    ]).state;
    const call = builtPortal("portal:login>shared");
    const entered = navigator.step(atLogin, portal("portal:login>shared"));
    expect(entered.teleport).toEqual(call.arrival);
    expect(entered.state.roomId).toBe("shared");
    expect(entered.state.frames.at(-1)).toEqual({
      portalId: "portal:login>shared",
      callerRoomId: "login",
      calleeRoomId: "shared",
      returnTo: call.returnPoint,
    });
    // The room report that follows the teleport changes nothing.
    const reported = navigator.step(entered.state, room("shared"));
    expect(reported.state).toBe(entered.state);
    expect(reported.teleport).toBeNull();

    const returned = navigator.step(reported.state, portal("return:shared"));
    expect(returned.teleport).toEqual(call.returnPoint);
    expect(returned.state).toEqual(atLogin);
  });

  it("sends an empty-stack return to the module hub", () => {
    const atMain = run(navigator, [room("hub"), room("main")]).state;
    const step = navigator.step(atMain, portal("return:main"));
    expect(step.teleport).toEqual(builtPortal("return:main").arrival);
    expect(step.teleport?.position).toEqual(world.built.start);
    expect(step.state).toEqual({ frames: [], roomId: "hub" });
  });

  it("unwinds recursion one portal entry at a time", () => {
    const start = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
      room("validate"),
    ]).state;
    const twice = run(navigator, [
      portal("portal:validate>validate"),
      portal("portal:validate>validate"),
    ]);
    const deep = run(
      navigator,
      [portal("portal:validate>validate"), portal("portal:validate>validate")],
      start
    );
    expect(twice.teleports.every((point) => point !== null)).toBe(true);
    expect(deep.state.frames).toHaveLength(4);
    expect(deep.state.roomId).toBe("validate");
    const recursion = builtPortal("portal:validate>validate");
    expect(deep.state.frames.at(-1)?.returnTo).toEqual(recursion.returnPoint);
    const unwound = run(
      navigator,
      [portal("return:validate"), portal("return:validate")],
      deep.state
    );
    expect(unwound.state.frames).toHaveLength(2);
    expect(unwound.teleports).toEqual([
      recursion.returnPoint.position,
      recursion.returnPoint.position,
    ]);
  });

  it("unwinds to a callee's frame when the player walks out through its call door", () => {
    // Enter shared by portal from login, then walk out through main's door.
    const inShared = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
      portal("portal:login>shared"),
    ]).state;
    expect(inShared.frames.map((frame) => frame.calleeRoomId)).toEqual([
      "login",
      "shared",
    ]);
    const out = navigator.step(inShared, room("main"));
    expect(out.teleport).toBeNull();
    expect(out.state).toEqual({ frames: [], roomId: "main" });
    // Walking out of a room the stack never entered leaves it alone.
    const stranger = navigator.step(
      { frames: [], roomId: "shared" },
      room("main")
    );
    expect(stranger.state).toEqual({ frames: [], roomId: "main" });
  });

  it("treats Backspace as the room's return portal, and stays put with nothing to return to", () => {
    const atLogin = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
    ]).state;
    const back = navigator.step(atLogin, { type: "back" });
    expect(back.state.frames).toEqual([]);
    expect(back.state.roomId).toBe("main");
    expect(
      inRoom(world, "main", back.teleport?.position ?? { x: 0, z: 0 })
    ).toBe(true);
    const inHub = navigator.step(
      { frames: [], roomId: "hub" },
      { type: "back" }
    );
    expect(inHub.teleport).toBeNull();
    expect(inHub.state).toEqual({ frames: [], roomId: "hub" });
  });

  it("resolves a call door that opens onto a corridor", () => {
    const corridorWorld = [2, 3, 5, 4, 6, 7, 8]
      .map((seed) => portalWorld(seed))
      .find((candidate) =>
        candidate.layout.rooms.some(
          (data) =>
            data.kind === "corridor" &&
            data.connection?.from === "main" &&
            data.connection.to === "login"
        )
      );
    expect(corridorWorld).toBeDefined();
    if (corridorWorld === undefined) {
      return;
    }
    const nav = createNavigator(corridorWorld);
    const { state } = run(nav, [room("hub"), room("main"), room("login")]);
    const frame = state.frames[0];
    expect(frame?.calleeRoomId).toBe("login");
    expect(
      inRoom(corridorWorld, "main", frame?.returnTo.position ?? { x: 0, z: 0 })
    ).toBe(true);
  });

  it("goes home with an empty stack", () => {
    const deep = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
      portal("portal:login>shared"),
    ]).state;
    const home = navigator.step(deep, { type: "home" });
    expect(home.state).toEqual({ frames: [], roomId: "hub" });
    expect(home.teleport).toEqual({
      position: world.built.start,
      facing: world.built.facing,
    });
  });

  it("ignores unknown portals and never mutates its input", () => {
    const state = run(navigator, [
      room("hub"),
      room("main"),
      room("login"),
    ]).state;
    const before = JSON.stringify(state);
    expect(navigator.step(state, portal("portal:nope"))).toEqual({
      state,
      teleport: null,
    });
    navigator.step(state, portal("portal:login>shared"));
    navigator.step(state, room("validate"));
    navigator.step(state, { type: "home" });
    expect(JSON.stringify(state)).toBe(before);
  });
});
