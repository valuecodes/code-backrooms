import type { AreaWorld, BuiltArea } from "@repo/types";

import { AREA_GAP, SHELF_WIDTH, stripRange } from "./areas";
import { rectGap } from "./fit";
import { roomBounds } from "./geometry";
import { blocked, checkLayout } from "./layout-checks";
import { containsPoint } from "./locate";

/** Ids that more than one area uses, each named once. */
const shared = (
  areas: readonly BuiltArea[],
  idsOf: (area: BuiltArea) => readonly string[]
): readonly string[] => {
  const owner = new Map<string, string>();
  const clashes = new Set<string>();
  for (const area of areas) {
    for (const id of new Set(idsOf(area))) {
      if (owner.has(id) && owner.get(id) !== area.id) {
        clashes.add(id);
      }
      owner.set(id, area.id);
    }
  }
  return [...clashes];
};

/**
 * Every portal into another area: it leads to a unit some area has, lands
 * inside that unit's room there, clear of the walls; one into an area not
 * generated yet, or one that failed, only has to name a unit of it.
 * Returns the areas each area's placed portals reach.
 */
const checkCrossings = (
  world: AreaWorld,
  failures: string[]
): ReadonlyMap<string, ReadonlySet<string>> => {
  const byId = new Map(world.areas.map((area) => [area.id, area]));
  const pending = new Set([...world.pending, ...world.failed]);
  const reaches = new Map<string, Set<string>>();
  for (const area of world.areas) {
    const own = new Set<string>();
    reaches.set(area.id, own);
    for (const { portal, arrival } of area.built.portals) {
      const areaId = world.areaOf.get(portal.to) ?? "";
      if (arrival !== null || pending.has(areaId)) {
        continue;
      }
      const target = byId.get(areaId);
      const landing = target?.built.entries.get(portal.to);
      if (target === undefined || landing === undefined) {
        failures.push(`portal ${portal.id} leads to unknown unit ${portal.to}`);
        continue;
      }
      own.add(target.id);
      const room = target.layout.rooms.find(
        (candidate) =>
          (candidate.id === portal.to || candidate.cluster === portal.to) &&
          containsPoint(roomBounds(candidate), landing.position)
      );
      if (
        room === undefined ||
        blocked(target.built.colliders, landing.position)
      ) {
        failures.push(
          `portal ${portal.id} lands somewhere unwalkable in ${target.id}`
        );
      }
    }
  }
  return reaches;
};

/** The areas reachable from `from` over `reaches`, among `among` only. */
const reachableFrom = (
  from: string,
  reaches: ReadonlyMap<string, ReadonlySet<string>>,
  among: ReadonlySet<string>
): ReadonlySet<string> => {
  const seen = new Set([from]);
  const queue = [from];
  // for...of sees areas pushed while iterating, so this is a plain BFS.
  for (const id of queue) {
    for (const next of reaches.get(id) ?? []) {
      if (among.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
};

/**
 * The zones of `world`: every area's `zoneId` is the zone that lists it;
 * every area no wider than SHELF_WIDTH inside its zone's strip (strip 0
 * outside every zone); every zone hub led to by a placed portal of the
 * entry area (built for pending hubs too); and, once all of a zone's areas are built,
 * each reachable from its hub over portals between them. A zone with an
 * area pending or failed is not walked: a portal from another zone may
 * have generated an area before its hub, and areas behind a failed one are
 * out of reach inside the zone.
 */
const checkZones = (
  world: AreaWorld,
  reaches: ReadonlyMap<string, ReadonlySet<string>>,
  failures: string[]
) => {
  const entry = world.areas.find((area) => area.id === world.entry);
  if (entry === undefined) {
    return;
  }
  const zoneOf = new Map(
    world.zones.flatMap((zone, at) =>
      zone.areas.map((id) => [id, { zone, strip: at + 1 }] as const)
    )
  );
  for (const area of world.areas) {
    const listed = zoneOf.get(area.id);
    if (area.zoneId !== (listed?.zone.id ?? null)) {
      failures.push(
        `area ${area.id} has zoneId ${area.zoneId}, expected ${listed?.zone.id ?? null}`
      );
    }
    const strip = stripRange(entry.bounds.minX, listed?.strip ?? 0);
    if (
      area.bounds.maxX - area.bounds.minX <= SHELF_WIDTH &&
      (area.bounds.minX < strip.minX - 1e-9 ||
        area.bounds.maxX > strip.maxX + 1e-9)
    ) {
      failures.push(`area ${area.id} is outside its strip`);
    }
  }
  // Placed portals only: one left unplaced has no door. A placed portal into
  // a pending area is built too, with no arrival yet.
  const fromEntry = new Set(
    entry.built.portals.map(({ portal }) => world.areaOf.get(portal.to))
  );
  const built = new Set(world.areas.map((area) => area.id));
  for (const zone of world.zones) {
    const [hub] = zone.areas;
    if (hub === undefined) {
      continue;
    }
    if (!fromEntry.has(hub)) {
      failures.push(`zone ${zone.id} hub ${hub} is not reached from the entry`);
    }
    if (!zone.areas.every((id) => built.has(id))) {
      continue;
    }
    const seen = reachableFrom(hub, reaches, new Set(zone.areas));
    for (const id of zone.areas) {
      if (!seen.has(id)) {
        failures.push(
          `area ${id} of zone ${zone.id} is unreachable from its hub ${hub}`
        );
      }
    }
  }
};

/**
 * Every invariant of a world of areas, as failure messages: each area's own
 * `checkLayout`; room and portal ids unique across areas; areas at least
 * AREA_GAP apart, each start room at its offset; portals into other areas
 * landing in their unit; every area reachable from the entry over placed
 * portals; and the zones as `checkZones` has them.
 */
const checkAreas = (world: AreaWorld): string[] => {
  const failures: string[] = [];
  for (const area of world.areas) {
    failures.push(
      ...checkLayout(area.graph, area.layout).map(
        (failure) => `area ${area.id}: ${failure}`
      )
    );
    const start = area.layout.rooms.find(
      (room) => room.id === area.layout.startRoomId
    );
    if (start === undefined || !containsPoint(roomBounds(start), area.offset)) {
      failures.push(`area ${area.id} does not start at its offset`);
    }
  }
  for (const id of shared(world.areas, (area) =>
    area.layout.rooms.map((room) => room.id)
  )) {
    failures.push(`room ${id} is in more than one area`);
  }
  for (const id of shared(world.areas, (area) =>
    (area.graph.portals ?? []).map((portal) => portal.id)
  )) {
    failures.push(`portal ${id} is in more than one area`);
  }
  for (const [i, a] of world.areas.entries()) {
    for (const b of world.areas.slice(i + 1)) {
      if (rectGap(a.bounds, b.bounds) < AREA_GAP - 1e-9) {
        failures.push(
          `areas ${a.id} and ${b.id} are closer than ${AREA_GAP} m`
        );
      }
    }
  }
  const reaches = checkCrossings(world, failures);
  const seen = reachableFrom(
    world.entry,
    reaches,
    new Set(world.areas.map((area) => area.id))
  );
  for (const area of world.areas) {
    if (!seen.has(area.id)) {
      failures.push(`area ${area.id} is unreachable from ${world.entry}`);
    }
  }
  checkZones(world, reaches, failures);
  return failures;
};

export { checkAreas };
