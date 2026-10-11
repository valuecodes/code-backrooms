import type { AreaLink } from "@repo/code-graph/area-links";
import { isZoneHub } from "@repo/code-graph/zones";
import type {
  AreaWorld,
  BuiltArea,
  Placement,
  Point,
  Rect,
  RoomKind,
} from "@repo/types";
import { AREA_GAP, SHELF_WIDTH, stripRange } from "@repo/world-generator/areas";
import { roomBounds } from "@repo/world-generator/geometry";
import { areaAt } from "@repo/world-generator/locate";

// What the whole-world map draws, worked out without React or the DOM: every
// area of the world, generated or not, the zones' bands, the links between
// areas and the player. An area not generated yet has no place in the world,
// so it is drawn as a ghost on a shelf above its zone's strip.

type AreaState = "generated" | "pending" | "failed";

type MapAreaRoom = {
  readonly id: string;
  readonly kind: RoomKind;
  readonly rect: Rect;
};

type MapArea = {
  readonly id: string;
  readonly label: string;
  readonly kind: "entrance" | "zone" | "module";
  readonly zoneId: string | null;
  readonly state: AreaState;
  /** Its footprint once generated, otherwise its ghost's slot. */
  readonly rect: Rect;
  /** Its rooms and corridors; none for a ghost. */
  readonly rooms: readonly MapAreaRoom[];
  /** Why it could not be generated, for a failed area. */
  readonly error: string | null;
  /** The area the player starts in. */
  readonly entry: boolean;
};

type MapZone = {
  readonly id: string;
  readonly name: string;
  /** Its band: its generated areas and its ghosts, padded; null with neither. */
  readonly rect: Rect | null;
  /** Its module areas (not its hub) generated so far and in all. */
  readonly built: number;
  readonly total: number;
};

type MapLink = {
  readonly id: string;
  readonly kind: AreaLink["kind"];
  readonly from: Point;
  readonly to: Point;
  readonly fromArea: string;
  readonly toArea: string;
  /** The state of the area it leads into. */
  readonly target: AreaState;
  readonly count: number;
};

type MapPlayer = {
  readonly position: Point;
  /** Unit vector the player faces along. */
  readonly heading: Point;
  /** The area the player stands in, or null between areas. */
  readonly areaId: string | null;
};

type WorldMapModel = {
  /** Everything drawn: every area, ghost and zone band. */
  readonly bounds: Rect;
  readonly areas: readonly MapArea[];
  readonly zones: readonly MapZone[];
  readonly links: readonly MapLink[];
  readonly player: MapPlayer | null;
};

type WorldMapOptions = {
  readonly player?: Placement | null;
  /** The message of every area that could not be generated, by area id. */
  readonly errors?: ReadonlyMap<string, string>;
  /** What an area is called on the map; its id by default. */
  readonly labelOf?: (areaId: string) => string;
  /** The links to draw (`areaLinksOf`); none by default. */
  readonly links?: readonly AreaLink[];
};

/** A ghost's footprint and the gap between ghosts, in metres. */
const GHOST_WIDTH = 20;
const GHOST_DEPTH = 12;
const GHOST_GAP = 4;
/** Ghosts in one row of a strip's shelf: as many as its width holds. */
const GHOST_COLUMNS = Math.floor(SHELF_WIDTH / (GHOST_WIDTH + GHOST_GAP));
/** A zone's band past its areas: under half a gap, so bands never touch. */
const ZONE_PAD = 6;

const NO_ERRORS: ReadonlyMap<string, string> = new Map();

const unionOf = (rects: readonly Rect[]): Rect | null =>
  rects.length === 0
    ? null
    : {
        minX: Math.min(...rects.map((rect) => rect.minX)),
        maxX: Math.max(...rects.map((rect) => rect.maxX)),
        minZ: Math.min(...rects.map((rect) => rect.minZ)),
        maxZ: Math.max(...rects.map((rect) => rect.maxZ)),
      };

const padded = (rect: Rect, pad: number): Rect => ({
  minX: rect.minX - pad,
  maxX: rect.maxX + pad,
  minZ: rect.minZ - pad,
  maxZ: rect.maxZ + pad,
});

const centreOf = (rect: Rect): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

/**
 * Each strip's areas as the ghost shelf lists them: a zone's in its own
 * order (its hub first) on strip zone index + 1, every other area the
 * world knows of, sorted, on strip 0, as the packer assigns strips.
 */
const shelvesOf = (
  world: AreaWorld
): readonly { readonly strip: number; readonly areas: readonly string[] }[] => {
  const zoned = new Set(world.zones.flatMap((zone) => zone.areas));
  const unzoned = [
    ...world.areas.map((area) => area.id),
    ...world.pending,
    ...world.failed,
  ]
    .filter((id) => !zoned.has(id))
    .toSorted();
  return [
    { strip: 0, areas: unzoned },
    ...world.zones.map((zone, index) => ({
      strip: index + 1,
      areas: zone.areas,
    })),
  ];
};

/**
 * Where every area's ghost goes: its slot on the shelf above its strip,
 * rows growing away from the world (-Z). The entry area never moves and
 * every other one is packed at or below its top, and each strip starts at
 * a fixed distance from its left edge (`stripRange`), so a ghost keeps its
 * slot while the world grows and whatever order areas generate in.
 */
const ghostSlots = (world: AreaWorld): ReadonlyMap<string, Rect> => {
  const entry =
    world.areas.find((area) => area.id === world.entry) ?? world.areas[0];
  const left = entry?.bounds.minX ?? 0;
  const top = (entry?.bounds.minZ ?? 0) - AREA_GAP;
  const slots = new Map<string, Rect>();
  for (const { strip, areas } of shelvesOf(world)) {
    const start = stripRange(left, strip).minX;
    areas.forEach((id, index) => {
      const column = index % GHOST_COLUMNS;
      const row = Math.floor(index / GHOST_COLUMNS);
      const minX = start + column * (GHOST_WIDTH + GHOST_GAP);
      const maxZ = top - row * (GHOST_DEPTH + GHOST_GAP);
      slots.set(id, {
        minX,
        maxX: minX + GHOST_WIDTH,
        minZ: maxZ - GHOST_DEPTH,
        maxZ,
      });
    });
  }
  return slots;
};

const kindOf = (world: AreaWorld, id: string): MapArea["kind"] => {
  if (id === world.entry) {
    return "entrance";
  }
  return isZoneHub(id) ? "zone" : "module";
};

const generatedArea = (
  world: AreaWorld,
  area: BuiltArea,
  label: string
): MapArea => ({
  id: area.id,
  label,
  kind: kindOf(world, area.id),
  zoneId: area.zoneId,
  state: "generated",
  rect: area.bounds,
  rooms: area.layout.rooms.map((room) => ({
    id: room.id,
    kind: room.kind,
    rect: roomBounds(room),
  })),
  error: null,
  entry: area.id === world.entry,
});

/** Pending areas, then failed ones, each as a ghost in its slot. */
const ghostAreas = (
  world: AreaWorld,
  errors: ReadonlyMap<string, string>,
  labelOf: (areaId: string) => string
): readonly MapArea[] => {
  const slots = ghostSlots(world);
  const zoneOf = new Map(
    world.zones.flatMap((zone) => zone.areas.map((id) => [id, zone.id]))
  );
  const ghost = (id: string, state: AreaState): MapArea => ({
    id,
    label: labelOf(id),
    kind: kindOf(world, id),
    zoneId: zoneOf.get(id) ?? null,
    state,
    rect: slots.get(id) ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    rooms: [],
    error: state === "failed" ? (errors.get(id) ?? null) : null,
    entry: id === world.entry,
  });
  return [
    ...world.pending.map((id) => ghost(id, "pending")),
    ...world.failed.map((id) => ghost(id, "failed")),
  ];
};

const zonesOf = (
  world: AreaWorld,
  areas: ReadonlyMap<string, MapArea>
): readonly MapZone[] => {
  const built = new Set(world.areas.map((area) => area.id));
  return world.zones.map((zone): MapZone => {
    const ghosts = zone.areas.flatMap((id) => {
      const area = areas.get(id);
      return area === undefined || area.state === "generated"
        ? []
        : [area.rect];
    });
    const band = unionOf([
      ...(zone.bounds === null ? [] : [zone.bounds]),
      ...ghosts,
    ]);
    // Its hub comes first and is not a module.
    const modules = zone.areas.slice(1);
    return {
      id: zone.id,
      name: zone.name,
      rect: band === null ? null : padded(band, ZONE_PAD),
      built: modules.filter((id) => built.has(id)).length,
      total: modules.length,
    };
  });
};

/**
 * Where a link leaves its area: the frame of the first portal of its kind
 * there that leads into its target area, once the source is generated;
 * otherwise the centre of the source (or its ghost).
 */
const linkStart = (
  world: AreaWorld,
  link: AreaLink,
  source: MapArea
): Point => {
  const area = world.areas.find((candidate) => candidate.id === link.fromArea);
  const portal = area?.built.portals.find(
    ({ portal: data }) =>
      data.kind === link.kind && world.areaOf.get(data.to) === link.toArea
  );
  return portal === undefined
    ? centreOf(source.rect)
    : { x: portal.frame.center[0], z: portal.frame.center[2] };
};

const linksOf = (
  world: AreaWorld,
  links: readonly AreaLink[],
  areas: ReadonlyMap<string, MapArea>
): readonly MapLink[] =>
  links.flatMap((link): MapLink[] => {
    const source = areas.get(link.fromArea);
    const target = areas.get(link.toArea);
    if (source === undefined || target === undefined) {
      return [];
    }
    return [
      {
        id: `${link.kind}:${link.fromArea}->${link.toArea}`,
        kind: link.kind,
        from: linkStart(world, link, source),
        to: centreOf(target.rect),
        fromArea: link.fromArea,
        toArea: link.toArea,
        target: target.state,
        count: link.count,
      },
    ];
  });

/**
 * The player's marker: where they stand, the way they face (+Z when they
 * look at their own feet) and the area under them. Cheap on its own, so an
 * overlay can follow the player every frame and keep the rest of the map.
 */
const playerMarker = (world: AreaWorld, placement: Placement): MapPlayer => {
  const { position, facing } = placement;
  const dx = facing.x - position.x;
  const dz = facing.z - position.z;
  const length = Math.hypot(dx, dz);
  return {
    position,
    heading: length === 0 ? { x: 0, z: 1 } : { x: dx / length, z: dz / length },
    areaId: areaAt(world.areas, position, null)?.id ?? null,
  };
};

/** Before the first pose of a world with no areas: the origin, north up. */
const NO_POSE: Placement = {
  position: { x: 0, z: 0 },
  facing: { x: 0, z: -1 },
};

/**
 * Where the player starts: the entry area's start, facing what it faces
 * (the first area's without an entry area, the origin without any).
 */
const startPlacement = (world: AreaWorld): Placement => {
  const entry =
    world.areas.find((area) => area.id === world.entry) ?? world.areas[0];
  return entry === undefined
    ? NO_POSE
    : { position: entry.built.start, facing: entry.built.facing };
};

/** Label height in metres: a 140th of the map's width, kept readable. */
const LABEL_MIN = 1.5;
const LABEL_MAX = 5;
const LABELS_ACROSS = 140;

/**
 * How tall an area's label is drawn, in world metres: grows with the map so
 * it stays legible once the map is scaled to fit, within 1.5 and 5 m.
 */
const labelFontSize = (bounds: Rect): number =>
  Math.min(
    LABEL_MAX,
    Math.max(LABEL_MIN, (bounds.maxX - bounds.minX) / LABELS_ACROSS)
  );

/**
 * The whole world for the map: every generated area with its rooms, every
 * pending or failed one as a ghost above its zone's strip, each zone's
 * band, the links between areas, and the player when placed.
 */
const worldMapModel = (
  world: AreaWorld,
  {
    player = null,
    errors = NO_ERRORS,
    labelOf = (id) => id,
    links = [],
  }: WorldMapOptions = {}
): WorldMapModel => {
  const areas = [
    ...world.areas.map((area) => generatedArea(world, area, labelOf(area.id))),
    ...ghostAreas(world, errors, labelOf),
  ];
  const byId = new Map(areas.map((area) => [area.id, area]));
  const zones = zonesOf(world, byId);
  const bounds = unionOf([
    ...areas.map((area) => area.rect),
    ...zones.flatMap((zone) => (zone.rect === null ? [] : [zone.rect])),
  ]) ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return {
    bounds,
    areas,
    zones,
    links: linksOf(world, links, byId),
    player: player === null ? null : playerMarker(world, player),
  };
};

export { labelFontSize, playerMarker, startPlacement, worldMapModel };
export type { MapArea, MapPlayer, WorldMapModel };
