import type { AreaWorld, BuiltArea } from "@repo/types";

import { AREA_GAP } from "./areas";
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
 * inside that unit's room there, clear of the walls. Returns the areas each
 * area's placed portals reach.
 */
const checkCrossings = (
  world: AreaWorld,
  failures: string[]
): ReadonlyMap<string, ReadonlySet<string>> => {
  const byId = new Map(world.areas.map((area) => [area.id, area]));
  const reaches = new Map<string, Set<string>>();
  for (const area of world.areas) {
    const own = new Set<string>();
    reaches.set(area.id, own);
    for (const { portal, arrival } of area.built.portals) {
      if (arrival !== null) {
        continue;
      }
      const target = byId.get(world.areaOf.get(portal.to) ?? "");
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

/**
 * Every invariant of a world of areas, as failure messages: each area's own
 * `checkLayout`; room and portal ids unique across areas; areas at least
 * AREA_GAP apart, each start room at its offset; portals into other areas
 * landing in their unit; every area reachable from the entry over placed
 * portals.
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
  const seen = new Set([world.entry]);
  const queue = [world.entry];
  // for...of sees areas pushed while iterating, so this is a plain BFS.
  for (const id of queue) {
    for (const next of reaches.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const area of world.areas) {
    if (!seen.has(area.id)) {
      failures.push(`area ${area.id} is unreachable from ${world.entry}`);
    }
  }
  return failures;
};

export { checkAreas };
