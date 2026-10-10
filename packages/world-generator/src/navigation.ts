// The exploration stack: where the player entered each function and where a
// return takes them. Pure and three-free; the app feeds it the player's room
// changes and portal entries and applies the teleports it answers with.

import type {
  BuiltPortal,
  BuiltRoom,
  GeneratedWorld,
  Placement,
} from "@repo/types";

import { placementInside } from "./geometry";

type Frame = {
  /** The call portal used, or null when the player walked through a call door. */
  readonly portalId: string | null;
  readonly callerRoomId: string;
  readonly calleeRoomId: string;
  /** Just inside the caller's door or portal, facing into the caller room. */
  readonly returnTo: Placement;
};

type NavigationState = {
  readonly frames: readonly Frame[];
  /** The unit of the last room that was not a corridor; null before the first report. */
  readonly roomId: string | null;
};

type NavigationEvent =
  /** From the player: the room it is now in, or null outside every room. */
  | { readonly type: "room"; readonly roomId: string | null }
  /** From the player: it stepped into a portal. */
  | { readonly type: "portal"; readonly portalId: string }
  /** Backspace: the same as the current room's return portal. */
  | { readonly type: "back" }
  /** R: back to the world start with an empty stack. */
  | { readonly type: "home" };

type Step = {
  readonly state: NavigationState;
  /** Where to put the player, or null to leave them where they are. */
  readonly teleport: Placement | null;
};

type Navigator = {
  readonly initial: NavigationState;
  readonly step: (state: NavigationState, event: NavigationEvent) => Step;
};

type World = Pick<GeneratedWorld, "graph" | "built">;

/** Rooms of one unit share its id; a plain room is its own unit. */
const unitsOf = (built: readonly BuiltRoom[]): ReadonlyMap<string, string> =>
  new Map(built.map(({ room }) => [room.id, room.cluster ?? room.id]));

const stay = (state: NavigationState): Step => ({ state, teleport: null });

/**
 * The landing just inside the door of unit `caller` that leads into unit
 * `callee`, whether it opens straight into the callee or onto a corridor
 * that leads there. The door may be on any room of the caller.
 */
const doorPlacement = (
  caller: string,
  callee: string,
  rooms: ReadonlyMap<string, BuiltRoom>,
  unitOf: (roomId: string) => string
): Placement | null => {
  for (const built of rooms.values()) {
    if (built.room.kind === "corridor" || unitOf(built.room.id) !== caller) {
      continue;
    }
    const index = built.room.doors.findIndex((door) => {
      const target = rooms.get(door.targetRoomId)?.room;
      if (target === undefined) {
        return false;
      }
      const { connection } = target;
      return connection === undefined
        ? unitOf(target.id) === callee
        : (connection.from === caller && connection.to === callee) ||
            (connection.to === caller && connection.from === callee);
    });
    const opening = built.openings[index];
    if (index !== -1 && opening !== undefined) {
      return placementInside(built.room, opening.wall, opening.along);
    }
  }
  return null;
};

/** Call doors by caller unit, then callee unit, with the return landing. */
const callDoorsOf = (
  world: World,
  rooms: ReadonlyMap<string, BuiltRoom>,
  unitOf: (roomId: string) => string
): ReadonlyMap<string, ReadonlyMap<string, Placement>> => {
  const doors = new Map<string, Map<string, Placement>>();
  for (const connection of world.graph.connections) {
    if (connection.kind !== "call") {
      continue;
    }
    const placement = doorPlacement(
      connection.from,
      connection.to,
      rooms,
      unitOf
    );
    if (placement !== null) {
      const own = doors.get(connection.from) ?? new Map<string, Placement>();
      own.set(connection.to, placement);
      doors.set(connection.from, own);
    }
  }
  return doors;
};

const createNavigator = (world: World): Navigator => {
  const { built } = world;
  const rooms = new Map(built.rooms.map((room) => [room.room.id, room]));
  const units = unitsOf(built.rooms);
  const unitOf = (roomId: string): string => units.get(roomId) ?? roomId;
  const corridors = new Set(
    built.rooms
      .filter(({ room }) => room.kind === "corridor")
      .map(({ room }) => room.id)
  );
  const hubs = new Set(
    world.graph.rooms.filter((room) => room.hub === true).map((room) => room.id)
  );
  const callDoors = callDoorsOf(world, rooms, unitOf);
  const portals = new Map(
    built.portals.map((portal) => [portal.portal.id, portal])
  );
  // The first return portal of a unit in layout order answers Backspace.
  const returnPortalOf = new Map<string, BuiltPortal>();
  for (const portal of built.portals) {
    const unit = unitOf(portal.portal.from);
    if (portal.portal.kind === "return" && !returnPortalOf.has(unit)) {
      returnPortalOf.set(unit, portal);
    }
  }
  const start: Placement = { position: built.start, facing: built.facing };
  // The same default the layout applies.
  const startUnit = unitOf(world.graph.start ?? world.graph.rooms[0]?.id ?? "");

  /** Pops the top frame and lands at its return point; nothing to pop stays put. */
  const pop = (state: NavigationState): Step => {
    const top = state.frames.at(-1);
    if (top === undefined) {
      return stay(state);
    }
    return {
      state: { frames: state.frames.slice(0, -1), roomId: top.callerRoomId },
      teleport: top.returnTo,
    };
  };

  const enterPortal = (state: NavigationState, portal: BuiltPortal): Step => {
    const { kind, from, to } = portal.portal;
    if (kind === "marker") {
      return stay(state);
    }
    if (kind === "return") {
      return state.frames.length === 0
        ? {
            state: { frames: [], roomId: unitOf(to) },
            teleport: portal.arrival,
          }
        : pop(state);
    }
    const frames =
      kind === "call"
        ? [
            ...state.frames,
            {
              portalId: portal.portal.id,
              callerRoomId: unitOf(from),
              calleeRoomId: unitOf(to),
              returnTo: portal.returnPoint,
            },
          ]
        : state.frames;
    return { state: { frames, roomId: unitOf(to) }, teleport: portal.arrival };
  };

  const moveTo = (state: NavigationState, roomId: string): Step => {
    const to = unitOf(roomId);
    const from = state.roomId;
    if (hubs.has(to)) {
      return stay({ frames: [], roomId: to });
    }
    const returnTo = from === null ? undefined : callDoors.get(from)?.get(to);
    if (from !== null && returnTo !== undefined) {
      return stay({
        frames: [
          ...state.frames,
          { portalId: null, callerRoomId: from, calleeRoomId: to, returnTo },
        ],
        roomId: to,
      });
    }
    // Any other move is a walk back out: the top frame must be the room the
    // player is in, so whatever was entered on the way (by door or portal)
    // is unwound, however the player leaves it.
    let frames = state.frames;
    while (frames.length > 0 && frames.at(-1)?.calleeRoomId !== to) {
      frames = frames.slice(0, -1);
    }
    return stay({ frames, roomId: to });
  };

  const step = (state: NavigationState, event: NavigationEvent): Step => {
    switch (event.type) {
      case "room": {
        const { roomId } = event;
        if (
          roomId === null ||
          corridors.has(roomId) ||
          unitOf(roomId) === state.roomId
        ) {
          return stay(state);
        }
        return moveTo(state, roomId);
      }
      case "portal": {
        const portal = portals.get(event.portalId);
        return portal === undefined ? stay(state) : enterPortal(state, portal);
      }
      case "back": {
        const exit =
          state.roomId === null ? undefined : returnPortalOf.get(state.roomId);
        return exit === undefined ? pop(state) : enterPortal(state, exit);
      }
      case "home": {
        return { state: { frames: [], roomId: startUnit }, teleport: start };
      }
      default: {
        return stay(state);
      }
    }
  };

  return { initial: { frames: [], roomId: null }, step };
};

export { createNavigator };
export type { Frame, NavigationEvent, NavigationState, Navigator, Step };
