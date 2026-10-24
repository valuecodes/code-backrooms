// Areas: worlds generated one by one (a module each), then set apart on the
// plane so that none can be seen from another and joined by portals only.

import type {
  AreaWorld,
  AreaZone,
  BuiltArea,
  BuiltPortal,
  GeneratedWorld,
  Placement,
  Point,
  Rect,
  RoomData,
  UnloadedArea,
  WorldLayout,
} from "@repo/types";

import { AREA_GAP, GRID } from "./config";
import { buildWorld, roomBounds, wallAxis } from "./geometry";
import { packTree } from "./tree-packing";

/** A row of areas wraps along +Z once it is this wide. */
const SHELF_WIDTH = 512;

/** A zone of areas: its id, the name shown for it and its hub area. */
type ZoneSpec = {
  readonly id: string;
  readonly name: string;
  readonly hub: string;
};

/** An area to join in: its id and its world, laid out round the origin. */
type AreaPart = {
  readonly id: string;
  readonly world: GeneratedWorld;
  /** The id of its zone; none for an area outside every zone. */
  readonly zone?: string;
  /** The area it is reached from, placed beside it (`packTree`). */
  readonly parent?: string;
};

/** Rounds up to the grid, so a gap never shrinks below what was asked. */
const gridUp = (value: number): number => Math.ceil(value / GRID - 1e-9) * GRID;

/** The rect round every rect given. */
const unionOf = (rects: readonly Rect[]): Rect => ({
  minX: Math.min(...rects.map((rect) => rect.minX)),
  maxX: Math.max(...rects.map((rect) => rect.maxX)),
  minZ: Math.min(...rects.map((rect) => rect.minZ)),
  maxZ: Math.max(...rects.map((rect) => rect.maxZ)),
});

/** The footprint of every room. */
const layoutBounds = (rooms: readonly RoomData[]): Rect =>
  unionOf(rooms.map(roomBounds));

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

const wide = (rect: Rect) => rect.maxX - rect.minX > SHELF_WIDTH;

/**
 * Where each area goes, given its untranslated bounds, in order, for a
 * world whose areas have no parents (random and preset worlds). The first
 * stays where it is (its start room at the origin); each next sits
 * AREA_GAP past the previous along +X, and a row that would grow past
 * SHELF_WIDTH starts a new one AREA_GAP beyond everything, along +Z. An
 * area wider than SHELF_WIDTH goes AREA_GAP below everything placed, and
 * the next row starts below it. Offsets are on the grid. A pure function
 * of the sequence of bounds.
 */
const packOffsets = (bounds: readonly Rect[]): readonly Point[] => {
  const first = bounds[0];
  if (first === undefined) {
    return [];
  }
  const left = first.minX;
  // A row that starts at or above the floor is closed: it could grow into
  // the wide area below it.
  let floor = wide(first) ? first.maxZ : -Infinity;
  let cursor = first.maxX + AREA_GAP;
  let top = first.minZ;
  let bottom = first.maxZ;
  const offsets: Point[] = [{ x: 0, z: 0 }];
  for (const rect of bounds.slice(1)) {
    if (wide(rect)) {
      top = Math.max(floor, bottom) + AREA_GAP;
      cursor = left;
    } else if (
      top <= floor ||
      (cursor > left && cursor + rect.maxX - rect.minX > left + SHELF_WIDTH)
    ) {
      top = Math.max(bottom, floor) + AREA_GAP;
      cursor = left;
    }
    const offset = {
      x: gridUp(cursor - rect.minX),
      z: gridUp(top - rect.minZ),
    };
    offsets.push(offset);
    cursor = offset.x + rect.maxX + AREA_GAP;
    bottom = Math.max(bottom, offset.z + rect.maxZ);
    if (wide(rect)) {
      floor = offset.z + rect.maxZ;
    }
  }
  return offsets;
};

/**
 * Throws for an area of an unknown zone, a zoned entry (it keeps the
 * origin, outside every zone), and a zone whose hub is not one of its
 * areas; for a parent that is not an area, and a parented entry.
 */
const checkAreaSpecs = (
  zones: readonly ZoneSpec[],
  entry: string,
  members: readonly {
    readonly id: string;
    readonly zone?: string;
    readonly parent?: string;
  }[]
): void => {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const ids = new Set(members.map((member) => member.id));
  for (const { id, zone, parent } of members) {
    if (zone !== undefined && !zoneIds.has(zone)) {
      throw new Error(`Unknown zone "${zone}" of area "${id}"`);
    }
    if (id === entry && zone !== undefined) {
      throw new Error(`Entry area "${entry}" cannot be in a zone`);
    }
    if (parent !== undefined && !ids.has(parent)) {
      throw new Error(`Unknown parent "${parent}" of area "${id}"`);
    }
    if (id === entry && parent !== undefined) {
      throw new Error(`Entry area "${entry}" cannot have a parent`);
    }
  }
  for (const zone of zones) {
    if (members.find((member) => member.id === zone.hub)?.zone !== zone.id) {
      throw new Error(`Zone "${zone.id}" hub "${zone.hub}" is not in the zone`);
    }
  }
};

/** Every parented area by its parent, in member order; empty when none is. */
const parentsOf = (
  members: readonly { readonly id: string; readonly parent?: string }[]
): ReadonlyMap<string, string> =>
  new Map(
    members.flatMap(({ id, parent }) =>
      parent === undefined ? [] : [[id, parent] as const]
    )
  );

/**
 * Each zone with every area of it (built or not, hub first, then in member
 * order) and the bounds of its built ones and its unloaded ones, which keep
 * their place: a zone never shrinks.
 */
const areaZones = (
  zones: readonly ZoneSpec[],
  members: readonly { readonly id: string; readonly zone?: string }[],
  areas: readonly BuiltArea[],
  unloaded: readonly UnloadedArea[] = []
): readonly AreaZone[] =>
  zones.map((zone) => {
    const built = [...areas, ...unloaded].filter(
      (area) => area.zoneId === zone.id
    );
    return {
      id: zone.id,
      name: zone.name,
      areas: [
        zone.hub,
        ...members
          .filter((member) => member.zone === zone.id && member.id !== zone.hub)
          .map((member) => member.id),
      ],
      bounds: built.length === 0 ? null : unionOf(built.map((a) => a.bounds)),
    };
  });

/** An area's world moved by `offset` and built again there. */
const placeArea = (part: AreaPart, offset: Point): BuiltArea => {
  const zoneId = part.zone ?? null;
  if (offset.x === 0 && offset.z === 0) {
    const bounds = layoutBounds(part.world.layout.rooms);
    return { ...part.world, id: part.id, offset, bounds, zoneId };
  }
  const layout = translateLayout(part.world.layout, offset);
  const built = buildWorld(layout, new Set(part.world.graph.external ?? []));
  const bounds = layoutBounds(layout.rooms);
  return { ...part.world, layout, built, id: part.id, offset, bounds, zoneId };
};

/**
 * Sets the areas apart: `entry` first (so it keeps the origin), then the
 * others in the order given, each beside its parent (`packTree`) when any
 * area has one, else in rows (`packOffsets`). `areas` keeps the order
 * given.
 */
const assembleAreas = (
  seed: number,
  entry: string,
  parts: readonly AreaPart[],
  zones: readonly ZoneSpec[] = []
): AreaWorld => {
  const first = parts.find((part) => part.id === entry);
  if (first === undefined) {
    throw new Error(`Unknown entry area "${entry}"`);
  }
  checkAreaSpecs(zones, entry, parts);
  const parents = parentsOf(parts);
  const order = [first, ...parts.filter((part) => part !== first)];
  const slots = order.map((part) => ({
    id: part.id,
    rect: layoutBounds(part.world.layout.rooms),
  }));
  const offsets =
    parents.size > 0
      ? packTree(slots, parents)
      : packOffsets(slots.map((slot) => slot.rect));
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
  return {
    seed,
    entry,
    areas,
    pending: [],
    failed: [],
    unloaded: [],
    areaOf,
    zones: areaZones(zones, parts, areas),
  };
};

/** Where a portal into another area's unit lands, or null if nothing has it. */
const arrivalIn = (world: AreaWorld, unit: string): Placement | null => {
  const areaId = world.areaOf.get(unit);
  const area = world.areas.find((candidate) => candidate.id === areaId);
  return area?.built.entries.get(unit) ?? null;
};

/**
 * The portals of `area` that lead into an area not generated yet (or one
 * that failed): no arrival, not a marker, and no area of `world` has the
 * target. Within one area every cross-area portal has a null arrival, so
 * this is what tells a dark portal from a live one.
 */
const pendingPortals = (
  world: AreaWorld,
  area: BuiltArea
): readonly string[] => {
  const built = new Set(world.areas.map(({ id }) => id));
  return area.built.portals
    .filter(({ portal, arrival }) => {
      if (arrival !== null || portal.kind === "marker") {
        return false;
      }
      const target = world.areaOf.get(portal.to);
      return target === undefined || !built.has(target);
    })
    .map(({ portal }) => portal.id);
};

/**
 * Every area as one world, for the navigator: rooms,
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

export { AREA_GAP } from "./config";
export {
  areaZones,
  assembleAreas,
  checkAreaSpecs,
  layoutBounds,
  mergeAreas,
  packOffsets,
  parentsOf,
  pendingPortals,
  placeArea,
  SHELF_WIDTH,
  translateLayout,
};
export type { AreaPart, ZoneSpec };
