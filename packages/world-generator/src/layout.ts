import type {
  Connection,
  GraphRoom,
  PortalData,
  Rect,
  WorldGraph,
  WorldLayout,
} from "@repo/types";

import { candidateBatches } from "./candidates";
import type { Candidate } from "./candidates";
import { MAX_LAYOUT_ATTEMPTS } from "./config";
import { fit, NONE, snap } from "./fit";
import { adjacencyOf, connectionKey, validateGraph } from "./graph";
import { Placement } from "./placement";
import type { Endpoint } from "./placement";
import { placePortals } from "./portals";
import { createRng, shuffle } from "./random";
import type { Rng } from "./random";
import { footprintOf } from "./units";

type Failure = {
  readonly ok: false;
  readonly from: string;
  readonly to: string;
};

/** The layout gave up: `connection` is the one the last attempt could not place. */
class LayoutError extends Error {
  readonly connection: Connection;

  constructor(connection: Connection) {
    super(
      `Could not lay out the graph after ${MAX_LAYOUT_ATTEMPTS} attempts: no placement for ${connection.from} -> ${connection.to}. Rooms with many connections need longer walls.`
    );
    this.name = "LayoutError";
    this.connection = connection;
  }
}

type Attempt =
  | {
      readonly ok: true;
      readonly layout: Omit<WorldLayout, "unplacedPortals">;
      /** Portals clusters positioned themselves, already in world coordinates. */
      readonly prePlaced: readonly PortalData[];
    }
  | Failure;

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
  room: GraphRoom,
  neighbours: ReadonlySet<string>,
  variation: boolean
): Candidate | null => {
  const anchor = state.rects.get(anchorId);
  const ports = state.portsFor(anchorId, roomId);
  if (anchor === undefined || ports.length === 0) {
    return null;
  }
  const { cluster } = room;
  const touching = new Set([anchorId]);
  const next = candidateBatches(
    rng,
    anchor,
    ports,
    cluster === undefined ? () => room : (wall) => footprintOf(cluster, wall),
    variation
  );
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
      const score = state.closable(option, roomId, neighbours);
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

/**
 * Places a unit at `rect`: a plain room as is, a cluster oriented off
 * `wall`. The start unit has no parent, so a start cluster may hand out its
 * entry port.
 */
const placeUnit = (
  state: Placement,
  id: string,
  room: GraphRoom,
  wall: "north" | "south" | "east" | "west",
  rect: Rect,
  isStart = false
): Endpoint => {
  if (room.cluster !== undefined) {
    return state.addCluster(id, room.cluster, wall, rect, isStart);
  }
  state.add(id, "room", rect);
  return { unit: id, room: id };
};

const attempt = (
  graph: WorldGraph,
  start: string,
  rng: Rng,
  variation: boolean,
  corridorPrefix: string
): Attempt => {
  const byId = new Map(graph.rooms.map((room) => [room.id, room]));
  // Neighbour order decides who gets the free wall space first; shuffling it
  // per attempt means a retry explores a genuinely different packing.
  const adjacency = new Map(
    [...adjacencyOf(graph)].map(([id, ids]) => [id, shuffle(rng, ids)])
  );
  const reserved = new Set([
    ...byId.keys(),
    ...graph.rooms.flatMap(
      (room) => room.cluster?.rooms.map((inner) => inner.id) ?? []
    ),
  ]);
  const state = new Placement(
    reserved,
    new Map((graph.portals ?? []).map((portal) => [portal.id, portal])),
    corridorPrefix
  );
  const first = byId.get(start);
  if (first === undefined) {
    throw new Error(`Unknown start room "${start}"`);
  }
  const minX = snap(-first.width / 2);
  const minZ = snap(-first.depth / 2);
  const startRoomId = placeUnit(
    state,
    start,
    first,
    "south",
    { minX, maxX: minX + first.width, minZ, maxZ: minZ + first.depth },
    true
  ).room;

  // Breadth-first: each unit is placed against the neighbour that reached it.
  const queue = [start];
  // for...of sees rooms pushed while iterating, so this is a plain BFS.
  for (const anchorId of queue) {
    for (const roomId of adjacency.get(anchorId) ?? []) {
      const room = byId.get(roomId);
      if (room === undefined || state.rects.has(roomId)) {
        continue;
      }
      // Clusters are joined only through their ports, never closed to later.
      const neighbours = new Set(
        room.cluster === undefined
          ? (adjacency.get(roomId) ?? []).filter(
              (id) =>
                id !== anchorId && state.rects.has(id) && !state.isCluster(id)
            )
          : []
      );
      const chosen = choose(
        state,
        rng,
        anchorId,
        roomId,
        room,
        neighbours,
        variation
      );
      if (chosen === null) {
        return { ok: false, from: anchorId, to: roomId };
      }
      const to = placeUnit(state, roomId, room, chosen.wall, chosen.room);
      const from = { unit: anchorId, room: chosen.port.roomId };
      state.usePort(chosen.port);
      if (chosen.corridor === null) {
        state.join(from, chosen.wall, to);
      } else {
        state.corridor(from, chosen.wall, chosen.corridor, to);
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
    layout: { rooms: state.roomData(), startRoomId, unresolved },
    prePlaced: state.prePlaced,
  };
};

/**
 * Packings tried when the first leaves portals without a wall. Portal
 * placement is deterministic per packing, so a room that simply has more
 * portals than wall would otherwise cost every attempt on every seed.
 */
const PORTAL_PACKINGS = 4;

/** What a layout failed to realise, doors weighted far above portals. */
const shortfall = (layout: WorldLayout): number =>
  layout.unresolved.length * 1000 + layout.unplacedPortals.length;

/**
 * Places every unit of a validated graph on the plane. Deterministic for a
 * given graph and seed. Retries with a bumped seed when the greedy search
 * paints itself into a corner, then throws naming the connection it could
 * not place. Portals go onto free wall space afterwards (those a cluster
 * positioned itself first, so the rest keep clear of them); when a packing
 * leaves some without a wall, a few more packings are tried and the best
 * one is returned with its `unplacedPortals`, never an error. `variation`
 * lets tree corridors vary in width (CORRIDOR_WIDTHS); without it every
 * corridor is CORRIDOR_WIDTH. Corridor ids are `corridorPrefix` and a
 * number.
 */
const generateLayout = (
  graph: WorldGraph,
  seed: number,
  variation = true,
  corridorPrefix = "corridor-"
): WorldLayout => {
  validateGraph(graph);
  const start = graph.start ?? graph.rooms[0]?.id ?? "";
  let failure: Failure | null = null;
  let best: WorldLayout | null = null;
  let packings = 0;
  for (let tries = 0; tries < MAX_LAYOUT_ATTEMPTS; tries += 1) {
    const result = attempt(
      graph,
      start,
      createRng(seed + tries * 1_000_003),
      variation,
      corridorPrefix
    );
    if (!result.ok) {
      failure = result;
      continue;
    }
    const fixed = new Set(result.prePlaced.map((portal) => portal.id));
    const placed = placePortals(result.layout.rooms, [
      ...result.prePlaced,
      ...(graph.portals ?? []).filter((portal) => !fixed.has(portal.id)),
    ]);
    const layout: WorldLayout = {
      ...result.layout,
      rooms: placed.rooms,
      unplacedPortals: placed.unplaced,
    };
    if (placed.unplaced.length === 0) {
      return layout;
    }
    // A missing door matters more than a missing portal.
    if (best === null || shortfall(layout) < shortfall(best)) {
      best = layout;
    }
    packings += 1;
    if (packings >= PORTAL_PACKINGS) {
      break;
    }
  }
  if (best !== null) {
    return best;
  }
  const failed = graph.connections.find(
    (connection) =>
      failure !== null &&
      connectionKey(connection.from, connection.to) ===
        connectionKey(failure.from, failure.to)
  );
  throw new LayoutError(
    failed ?? { from: failure?.from ?? "?", to: failure?.to ?? "?" }
  );
};

export { generateLayout, LayoutError };
