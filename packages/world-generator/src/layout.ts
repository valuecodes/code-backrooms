import type {
  Connection,
  DoorData,
  Rect,
  RoomData,
  RoomKind,
  WallSide,
  WorldGraph,
  WorldLayout,
} from "@repo/types";

import { candidateBatches, hi, lo, makeRect, OUTWARD } from "./candidates";
import type { Axis, Candidate } from "./candidates";
import {
  CORRIDOR_WIDTH,
  MAX_CORRIDOR_LENGTH,
  MAX_LAYOUT_ATTEMPTS,
  MIN_GAP,
  MIN_SHARED,
} from "./config";
import { fit, NONE, sharedEdge, snap } from "./fit";
import type { Placed } from "./fit";
import { OPPOSITE } from "./geometry";
import { adjacencyOf, connectionKey, validateGraph } from "./graph";
import { placePortals } from "./portals";
import { createRng, shuffle } from "./random";
import type { Rng } from "./random";

type PlacedRoom = {
  readonly id: string;
  readonly kind: RoomKind;
  readonly rect: Rect;
  readonly doors: DoorData[];
  readonly connection?: Connection;
};

type Closure =
  | { readonly kind: "door" }
  | { readonly kind: "corridor"; readonly wall: WallSide; readonly rect: Rect };

type Failure = {
  readonly ok: false;
  readonly from: string;
  readonly to: string;
};

type Attempt =
  | { readonly ok: true; readonly layout: Omit<WorldLayout, "unplacedPortals"> }
  | Failure;

const WALLS: readonly WallSide[] = ["north", "south", "east", "west"];

const toRoomData = (room: PlacedRoom): RoomData => ({
  id: room.id,
  kind: room.kind,
  position: [
    (room.rect.minX + room.rect.maxX) / 2,
    0,
    (room.rect.minZ + room.rect.maxZ) / 2,
  ],
  width: room.rect.maxX - room.rect.minX,
  depth: room.rect.maxZ - room.rect.minZ,
  doors: room.doors,
  ...(room.connection === undefined ? {} : { connection: room.connection }),
});

/**
 * How two placed rects could be joined: a door if they share enough edge,
 * else a straight corridor across the gap if one fits, else nothing.
 */
const findClosure = (
  placed: Placed,
  from: string,
  to: string
): Closure | null => {
  const a = placed.get(from);
  const b = placed.get(to);
  if (a === undefined || b === undefined) {
    return null;
  }
  const edge = sharedEdge(a, b);
  if (edge !== null) {
    return edge.overlap >= MIN_SHARED ? { kind: "door" } : null;
  }
  const touching = new Set([from, to]);
  for (const wall of WALLS) {
    const { axis, sign } = OUTWARD[wall];
    const cross: Axis = axis === "x" ? "z" : "x";
    const gap =
      sign > 0 ? lo(b, axis) - hi(a, axis) : lo(a, axis) - hi(b, axis);
    if (gap < MIN_GAP || gap > MAX_CORRIDOR_LENGTH) {
      continue;
    }
    const crossLo = Math.max(lo(a, cross), lo(b, cross));
    const crossHi = Math.min(hi(a, cross), hi(b, cross)) - CORRIDOR_WIDTH;
    if (crossHi < crossLo) {
      continue;
    }
    const starts = [snap((crossLo + crossHi) / 2)];
    for (let start = crossLo; start <= crossHi; start += 0.5) {
      starts.push(start);
    }
    const [alongLo, alongHi] =
      sign > 0 ? [hi(a, axis), lo(b, axis)] : [hi(b, axis), lo(a, axis)];
    for (const start of starts) {
      const rect = makeRect(
        axis,
        alongLo,
        alongHi,
        start,
        start + CORRIDOR_WIDTH
      );
      if (fit(rect, placed, touching, NONE) !== null) {
        return { kind: "corridor", wall, rect };
      }
    }
  }
  return null;
};

/** Mutable placement state for one layout attempt. */
class Placement {
  readonly rooms = new Map<string, PlacedRoom>();
  readonly rects = new Map<string, Rect>();
  readonly resolved = new Set<string>();
  private corridors = 0;

  /** Every id the graph uses, so generated ids never shadow one. */
  constructor(private readonly reserved: ReadonlySet<string>) {}

  /** `prefix`, suffixed until it is neither a graph id nor placed. */
  freeId(prefix: string): string {
    let id = prefix;
    while (this.reserved.has(id) || this.rects.has(id)) {
      id = `${id}-`;
    }
    return id;
  }

  add(id: string, kind: RoomKind, rect: Rect, connection?: Connection): void {
    this.rects.set(id, rect);
    this.rooms.set(id, { id, kind, rect, doors: [], connection });
  }

  /** Declares the door on both sides of a shared edge. */
  connect(fromId: string, wall: WallSide, toId: string): void {
    this.rooms.get(fromId)?.doors.push({ wall, targetRoomId: toId });
    this.rooms
      .get(toId)
      ?.doors.push({ wall: OPPOSITE[wall], targetRoomId: fromId });
  }

  door(fromId: string, toId: string): void {
    const a = this.rects.get(fromId);
    const b = this.rects.get(toId);
    const edge = a !== undefined && b !== undefined ? sharedEdge(a, b) : null;
    if (edge === null) {
      throw new Error(`Rooms "${fromId}" and "${toId}" do not share an edge`);
    }
    this.connect(fromId, edge.wall, toId);
    this.resolved.add(connectionKey(fromId, toId));
  }

  corridor(fromId: string, wall: WallSide, rect: Rect, toId: string): void {
    this.corridors += 1;
    const id = this.freeId(`corridor-${this.corridors}`);
    this.add(id, "corridor", rect, { from: fromId, to: toId });
    this.connect(fromId, wall, id);
    this.connect(id, wall, toId);
    this.resolved.add(connectionKey(fromId, toId));
  }

  /** Joins two placed rooms if a door or straight corridor fits. */
  close(fromId: string, toId: string): boolean {
    const closure = findClosure(this.rects, fromId, toId);
    if (closure === null) {
      return false;
    }
    if (closure.kind === "door") {
      this.door(fromId, toId);
    } else {
      this.corridor(fromId, closure.wall, closure.rect, toId);
    }
    return true;
  }
}

/** Placed graph neighbours this candidate could be joined to right away. */
const closable = (
  state: Placement,
  option: Candidate,
  roomId: string,
  neighbours: ReadonlySet<string>
): number => {
  if (neighbours.size === 0) {
    return 0;
  }
  const preview = new Map(state.rects);
  preview.set(roomId, option.room);
  if (option.corridor !== null) {
    preview.set(state.freeId("preview-corridor"), option.corridor);
  }
  let count = 0;
  for (const id of neighbours) {
    if (findClosure(preview, roomId, id) !== null) {
      count += 1;
    }
  }
  return count;
};

/**
 * The first candidate that fits, unless a later one can also be joined to
 * more of the room's already-placed neighbours (which closes cycles early,
 * while the space beside them is still free).
 */
const choose = (
  state: Placement,
  rng: Rng,
  anchorId: string,
  roomId: string,
  room: { readonly width: number; readonly depth: number },
  neighbours: ReadonlySet<string>
): Candidate | null => {
  const anchor = state.rects.get(anchorId);
  if (anchor === undefined) {
    return null;
  }
  const touching = new Set([anchorId]);
  const next = candidateBatches(rng, anchor, room);
  let best: { readonly option: Candidate; readonly score: number } | null =
    null;
  for (let batch = next(); batch !== null; batch = next()) {
    for (const option of batch) {
      if (
        option.corridor !== null &&
        fit(option.corridor, state.rects, touching, NONE) === null
      ) {
        continue;
      }
      const result = fit(
        option.room,
        state.rects,
        option.corridor === null ? touching : NONE,
        neighbours
      );
      if (result === null) {
        continue;
      }
      const score = closable(state, option, roomId, neighbours);
      if (best === null || score > best.score) {
        best = { option, score };
      }
      if (best.score === neighbours.size) {
        return best.option;
      }
    }
  }
  return best?.option ?? null;
};

const attempt = (graph: WorldGraph, start: string, rng: Rng): Attempt => {
  const byId = new Map(graph.rooms.map((room) => [room.id, room]));
  // Neighbour order decides who gets the free wall space first; shuffling it
  // per attempt means a retry explores a genuinely different packing.
  const adjacency = new Map(
    [...adjacencyOf(graph)].map(([id, ids]) => [id, shuffle(rng, ids)])
  );
  const state = new Placement(new Set(byId.keys()));
  const first = byId.get(start);
  if (first === undefined) {
    throw new Error(`Unknown start room "${start}"`);
  }
  const minX = snap(-first.width / 2);
  const minZ = snap(-first.depth / 2);
  state.add(start, "room", {
    minX,
    maxX: minX + first.width,
    minZ,
    maxZ: minZ + first.depth,
  });

  // Breadth-first: each room is placed against the neighbour that reached it.
  const queue = [start];
  // for...of sees rooms pushed while iterating, so this is a plain BFS.
  for (const anchorId of queue) {
    for (const roomId of adjacency.get(anchorId) ?? []) {
      const room = byId.get(roomId);
      if (room === undefined || state.rects.has(roomId)) {
        continue;
      }
      const neighbours = new Set(
        (adjacency.get(roomId) ?? []).filter(
          (id) => id !== anchorId && state.rects.has(id)
        )
      );
      const chosen = choose(state, rng, anchorId, roomId, room, neighbours);
      if (chosen === null) {
        return { ok: false, from: anchorId, to: roomId };
      }
      state.add(roomId, "room", chosen.room);
      if (chosen.corridor === null) {
        state.connect(anchorId, chosen.wall, roomId);
        state.resolved.add(connectionKey(anchorId, roomId));
      } else {
        state.corridor(anchorId, chosen.wall, chosen.corridor, roomId);
      }
      for (const id of neighbours) {
        state.close(roomId, id);
      }
      queue.push(roomId);
    }
  }

  // Everything is placed; try once more to close whatever is still open.
  const unresolved: Connection[] = [];
  for (const connection of graph.connections) {
    if (state.resolved.has(connectionKey(connection.from, connection.to))) {
      continue;
    }
    if (!state.close(connection.from, connection.to)) {
      unresolved.push(connection);
    }
  }
  if (state.resolved.size + unresolved.length !== graph.connections.length) {
    throw new Error("Layout lost track of a connection");
  }
  return {
    ok: true,
    layout: {
      rooms: [...state.rooms.values()].map(toRoomData),
      startRoomId: start,
      unresolved,
    },
  };
};

/**
 * Places every room of a validated graph on the plane. Deterministic for a
 * given graph and seed. Retries with a bumped seed when the greedy search
 * paints itself into a corner, then throws naming the connection it could
 * not place. Portals go onto free wall space afterwards; when a packing
 * leaves some without a wall, later attempts are tried and the best one is
 * returned with its `unplacedPortals`, never an error.
 */
const generateLayout = (graph: WorldGraph, seed: number): WorldLayout => {
  validateGraph(graph);
  const start = graph.start ?? graph.rooms[0]?.id ?? "";
  let failure: Failure | null = null;
  let best: WorldLayout | null = null;
  for (let tries = 0; tries < MAX_LAYOUT_ATTEMPTS; tries += 1) {
    const result = attempt(graph, start, createRng(seed + tries * 1_000_003));
    if (!result.ok) {
      failure = result;
      continue;
    }
    const placed = placePortals(result.layout.rooms, graph.portals ?? []);
    const layout: WorldLayout = {
      ...result.layout,
      rooms: placed.rooms,
      unplacedPortals: placed.unplaced,
    };
    if (placed.unplaced.length === 0) {
      return layout;
    }
    if (best === null || placed.unplaced.length < best.unplacedPortals.length) {
      best = layout;
    }
  }
  if (best !== null) {
    return best;
  }
  const edge = failure === null ? "?" : `${failure.from} -> ${failure.to}`;
  throw new Error(
    `Could not lay out the graph after ${MAX_LAYOUT_ATTEMPTS} attempts: no placement for ${edge}. Rooms with many connections need longer walls.`
  );
};

export { generateLayout };
