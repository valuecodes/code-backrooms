// Areas: worlds generated one by one (a module each), then set apart on the
// plane so that none can be seen from another and joined by portals only.

import type {
  AreaWorld,
  BuiltArea,
  BuiltPortal,
  GeneratedWorld,
  Placement,
  Point,
  Rect,
  RoomData,
  WorldLayout,
} from "@repo/types";

import { GRID } from "./config";
import { buildWorld, roomBounds, wallAxis } from "./geometry";

/** Metres between two areas: past the fog (28 m), so a neighbour never shows. */
const AREA_GAP = 32;

/** A row of areas wraps along +Z once it is this wide. */
const SHELF_WIDTH = 512;

/** An area to join in: its id and its world, laid out round the origin. */
type AreaPart = {
  readonly id: string;
  readonly world: GeneratedWorld;
};

/** Rounds up to the grid, so a gap never shrinks below what was asked. */
const gridUp = (value: number): number => Math.ceil(value / GRID - 1e-9) * GRID;

/** The footprint of every room. */
const layoutBounds = (rooms: readonly RoomData[]): Rect => {
  const rects = rooms.map(roomBounds);
  return {
    minX: Math.min(...rects.map((rect) => rect.minX)),
    maxX: Math.max(...rects.map((rect) => rect.maxX)),
    minZ: Math.min(...rects.map((rect) => rect.minZ)),
    maxZ: Math.max(...rects.map((rect) => rect.maxZ)),
  };
};

/** The layout moved by `offset`: room centres and portal positions on their walls. */
const translateLayout = (layout: WorldLayout, offset: Point): WorldLayout => ({
  ...layout,
  rooms: layout.rooms.map((room) => ({
    ...room,
    position: [
      room.position[0] + offset.x,
      room.position[1],
      room.position[2] + offset.z,
    ],
    ...(room.portals === undefined
      ? {}
      : {
          portals: room.portals.map((portal) => ({
            ...portal,
            along:
              portal.along +
              (wallAxis(portal.wall) === "x" ? offset.x : offset.z),
          })),
        }),
  })),
});

/**
 * Where each area goes, given its untranslated bounds, in order: the first
 * stays where it is (its start room at the origin), each next one sits
 * AREA_GAP past the previous along +X, and a row that would grow past
 * SHELF_WIDTH starts a new one AREA_GAP beyond everything placed, along +Z.
 * Offsets are on the grid. A pure function of the sequence of bounds.
 */
const packOffsets = (bounds: readonly Rect[]): readonly Point[] => {
  const first = bounds[0];
  if (first === undefined) {
    return [];
  }
  const left = first.minX;
  let cursor = first.maxX + AREA_GAP;
  let top = first.minZ;
  let bottom = first.maxZ;
  const offsets: Point[] = [{ x: 0, z: 0 }];
  for (const rect of bounds.slice(1)) {
    if (cursor > left && cursor + rect.maxX - rect.minX > left + SHELF_WIDTH) {
      top = bottom + AREA_GAP;
      cursor = left;
    }
    const offset = {
      x: gridUp(cursor - rect.minX),
      z: gridUp(top - rect.minZ),
    };
    offsets.push(offset);
    cursor = offset.x + rect.maxX + AREA_GAP;
    bottom = Math.max(bottom, offset.z + rect.maxZ);
  }
  return offsets;
};

/** An area's world moved by `offset` and built again there. */
const placeArea = (part: AreaPart, offset: Point): BuiltArea => {
  if (offset.x === 0 && offset.z === 0) {
    const bounds = layoutBounds(part.world.layout.rooms);
    return { ...part.world, id: part.id, offset, bounds };
  }
  const layout = translateLayout(part.world.layout, offset);
  const built = buildWorld(layout, new Set(part.world.graph.external ?? []));
  const bounds = layoutBounds(layout.rooms);
  return { ...part.world, layout, built, id: part.id, offset, bounds };
};

/**
 * Sets the areas apart: `entry` first (so it keeps the origin), then the
 * others in the order given. `areas` keeps the order given.
 */
const assembleAreas = (
  seed: number,
  entry: string,
  parts: readonly AreaPart[]
): AreaWorld => {
  const first = parts.find((part) => part.id === entry);
  if (first === undefined) {
    throw new Error(`Unknown entry area "${entry}"`);
  }
  const order = [first, ...parts.filter((part) => part !== first)];
  const offsets = packOffsets(
    order.map((part) => layoutBounds(part.world.layout.rooms))
  );
  const offsetOf = new Map(
    order.map((part, index) => [part.id, offsets[index] ?? { x: 0, z: 0 }])
  );
  const areas = parts.map((part) =>
    placeArea(part, offsetOf.get(part.id) ?? { x: 0, z: 0 })
  );
  const areaOf = new Map(
    areas.flatMap((area) =>
      area.graph.rooms.map((room) => [room.id, area.id] as const)
    )
  );
  return { seed, entry, areas, areaOf };
};

/** Where a portal into another area's unit lands, or null if nothing has it. */
const arrivalIn = (world: AreaWorld, unit: string): Placement | null => {
  const areaId = world.areaOf.get(unit);
  const area = world.areas.find((candidate) => candidate.id === areaId);
  return area?.built.entries.get(unit) ?? null;
};

/**
 * Every area as one world, for the renderer and the navigator: rooms,
 * walls and portals together, cross-area arrivals resolved, the start in
 * the entry area. Not a layout to validate: its graph has one component
 * per area, so `checkLayout` does not apply; `checkAreas` does.
 */
const mergeAreas = (world: AreaWorld): GeneratedWorld => {
  const entry = world.areas.find((area) => area.id === world.entry);
  if (entry === undefined) {
    throw new Error(`Unknown entry area "${world.entry}"`);
  }
  if (world.areas.length === 1) {
    const { seed, graph, layout, built } = entry;
    return { seed, graph, layout, built };
  }
  const { areas } = world;
  const start = entry.graph.start ?? entry.graph.rooms[0]?.id;
  const portals = areas.flatMap((area) =>
    area.built.portals.map((portal): BuiltPortal =>
      portal.arrival === null
        ? { ...portal, arrival: arrivalIn(world, portal.portal.to) }
        : portal
    )
  );
  return {
    seed: world.seed,
    graph: {
      rooms: areas.flatMap((area) => area.graph.rooms),
      connections: areas.flatMap((area) => area.graph.connections),
      portals: areas.flatMap((area) => area.graph.portals ?? []),
      ...(start === undefined ? {} : { start }),
    },
    layout: {
      rooms: areas.flatMap((area) => area.layout.rooms),
      startRoomId: entry.layout.startRoomId,
      unresolved: areas.flatMap((area) => area.layout.unresolved),
      unplacedPortals: areas.flatMap((area) => area.layout.unplacedPortals),
    },
    built: {
      rooms: areas.flatMap((area) => area.built.rooms),
      doorways: areas.flatMap((area) => area.built.doorways),
      portals,
      colliders: areas.flatMap((area) => area.built.colliders),
      start: entry.built.start,
      facing: entry.built.facing,
      entries: new Map(areas.flatMap((area) => [...area.built.entries])),
    },
  };
};

export {
  AREA_GAP,
  assembleAreas,
  layoutBounds,
  mergeAreas,
  packOffsets,
  SHELF_WIDTH,
  translateLayout,
};
export type { AreaPart };
