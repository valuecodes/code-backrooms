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
  WorldLayout,
} from "@repo/types";

import { GRID } from "./config";
import { buildWorld, roomBounds, wallAxis } from "./geometry";

/** Metres between two areas: past the fog (28 m), so a neighbour never shows. */
const AREA_GAP = 32;

/** A row of areas wraps along +Z once it is this wide. */
const SHELF_WIDTH = 512;

/**
 * Metres from one zone's strip to the next: the shelf, the one grid step
 * rounding can push an area past it, and the gap.
 */
const STRIP_PITCH = SHELF_WIDTH + GRID + AREA_GAP;

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
};

/** An area's untranslated bounds and the strip it goes in (0 for no zone). */
type Slot = {
  readonly rect: Rect;
  readonly strip: number;
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

/** Where strip `strip` lies along X when the first area's left edge is `left`. */
const stripRange = (
  left: number,
  strip: number
): { readonly minX: number; readonly maxX: number } => {
  const minX = left + strip * STRIP_PITCH;
  return { minX, maxX: minX + SHELF_WIDTH + GRID };
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
 * A strip's current row: where its next area goes along X, the row's top,
 * and how far down (+Z) the strip reaches.
 */
type Shelf = { cursor: number; top: number; bottom: number };

/**
 * Where each area goes, given its untranslated bounds and strip, in order.
 * The first stays where it is (its start room at the origin) and opens
 * strip 0; strip k starts STRIP_PITCH·k past the first area's left edge.
 * Within its strip each next area sits AREA_GAP past the previous along +X,
 * and a row that would grow past SHELF_WIDTH starts a new one AREA_GAP
 * beyond everything in the strip, along +Z. An area wider than SHELF_WIDTH
 * fits no strip: it goes AREA_GAP below everything placed, at its strip's
 * left, and every strip's next row starts below it. Offsets are on the
 * grid. A pure function of the sequence of slots.
 */
const packSlots = (slots: readonly Slot[]): readonly Point[] => {
  const first = slots[0]?.rect;
  if (first === undefined) {
    return [];
  }
  const left = first.minX;
  const wide = (rect: Rect) => rect.maxX - rect.minX > SHELF_WIDTH;
  // A row that starts at or above the floor is closed: it could grow into
  // the wide area below it.
  let floor = wide(first) ? first.maxZ : -Infinity;
  const shelves = new Map<number, Shelf>([
    [0, { cursor: first.maxX + AREA_GAP, top: first.minZ, bottom: first.maxZ }],
  ]);
  const offsets: Point[] = [{ x: 0, z: 0 }];
  for (const { rect, strip } of slots.slice(1)) {
    const start = stripRange(left, strip).minX;
    const shelf = shelves.get(strip) ?? {
      cursor: start,
      top: first.minZ,
      bottom: first.minZ,
    };
    shelves.set(strip, shelf);
    if (wide(rect)) {
      shelf.top =
        Math.max(floor, ...[...shelves.values()].map((s) => s.bottom)) +
        AREA_GAP;
      shelf.cursor = start;
    } else if (
      shelf.top <= floor ||
      (shelf.cursor > start &&
        shelf.cursor + rect.maxX - rect.minX > start + SHELF_WIDTH)
    ) {
      shelf.top = Math.max(shelf.bottom, floor) + AREA_GAP;
      shelf.cursor = start;
    }
    const offset = {
      x: gridUp(shelf.cursor - rect.minX),
      z: gridUp(shelf.top - rect.minZ),
    };
    offsets.push(offset);
    shelf.cursor = offset.x + rect.maxX + AREA_GAP;
    shelf.bottom = Math.max(shelf.bottom, offset.z + rect.maxZ);
    if (wide(rect)) {
      floor = offset.z + rect.maxZ;
    }
  }
  return offsets;
};

/** `packSlots` with every area outside every zone. */
const packOffsets = (bounds: readonly Rect[]): readonly Point[] =>
  packSlots(bounds.map((rect) => ({ rect, strip: 0 })));

/**
 * The strip of every area by id: its zone's index + 1, 0 outside every
 * zone. Throws for an area of an unknown zone, a zoned entry (it keeps the
 * origin, in strip 0), and a zone whose hub is not one of its areas.
 */
const stripsOf = (
  zones: readonly ZoneSpec[],
  entry: string,
  members: readonly { readonly id: string; readonly zone?: string }[]
): ReadonlyMap<string, number> => {
  const index = new Map(zones.map((zone, at) => [zone.id, at + 1]));
  const strips = new Map<string, number>();
  for (const { id, zone } of members) {
    if (zone === undefined) {
      strips.set(id, 0);
      continue;
    }
    const strip = index.get(zone);
    if (strip === undefined) {
      throw new Error(`Unknown zone "${zone}" of area "${id}"`);
    }
    if (id === entry) {
      throw new Error(`Entry area "${entry}" cannot be in a zone`);
    }
    strips.set(id, strip);
  }
  for (const zone of zones) {
    if (members.find((member) => member.id === zone.hub)?.zone !== zone.id) {
      throw new Error(`Zone "${zone.id}" hub "${zone.hub}" is not in the zone`);
    }
  }
  return strips;
};

/**
 * Each zone with every area of it (built or not, hub first, then in member
 * order) and the bounds of its built ones.
 */
const areaZones = (
  zones: readonly ZoneSpec[],
  members: readonly { readonly id: string; readonly zone?: string }[],
  areas: readonly BuiltArea[]
): readonly AreaZone[] =>
  zones.map((zone) => {
    const built = areas.filter((area) => area.zoneId === zone.id);
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
 * others in the order given, each in its zone's strip. `areas` keeps the
 * order given.
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
  const strips = stripsOf(zones, entry, parts);
  const order = [first, ...parts.filter((part) => part !== first)];
  const offsets = packSlots(
    order.map((part) => ({
      rect: layoutBounds(part.world.layout.rooms),
      strip: strips.get(part.id) ?? 0,
    }))
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
  return {
    seed,
    entry,
    areas,
    pending: [],
    failed: [],
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

export {
  AREA_GAP,
  areaZones,
  assembleAreas,
  layoutBounds,
  mergeAreas,
  packOffsets,
  packSlots,
  pendingPortals,
  placeArea,
  SHELF_WIDTH,
  stripRange,
  stripsOf,
  translateLayout,
};
export type { AreaPart, Slot, ZoneSpec };
