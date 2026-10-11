// Zones: the packages of a monorepo as places. Each package that owns a
// module is a zone with a hub area of its own between the entrance and the
// package's entry modules; modules no package owns share one more zone.

import type { CodeGraph, ModuleNode, PackageNode } from "./code-graph";
import { repositoryName } from "./entrance";
import { hubModuleId } from "./ids";
import { owningPackage } from "./packages";

type Zone = {
  /** Its first hub's id, which is also its area's: `//zone:@repo/x`. */
  readonly id: string;
  /** The package's name, or the repository's for the modules none owns. */
  readonly name: string;
  /** Null for the modules no package owns. */
  readonly pkg: PackageNode | null;
  /** In graph order. */
  readonly modules: readonly ModuleNode[];
};

/**
 * A zone hub id names its package. `normalisePath` never yields `//`, so no
 * module id, and no id built on one, can start with it.
 */
const ZONE_ID = "//zone";
const ZONE_PREFIX = `${ZONE_ID}:`;

/**
 * The zone of a package: `//zone:@repo/x`; of the modules no package owns:
 * `//zone`. A `#` in the package id is escaped, as hub chains end in `#<n>`.
 */
const zoneId = (packageId: string | null): string =>
  packageId === null
    ? ZONE_ID
    : `${ZONE_PREFIX}${packageId.replaceAll("#", "%23")}`;

/** Whether a room is one of a zone's hubs: `//zone:@repo/x`, `//zone:@repo/x#2`. */
const isZoneHub = (roomId: string): boolean => {
  const head = hubModuleId(roomId);
  return head === ZONE_ID || head.startsWith(ZONE_PREFIX);
};

/** Ids of the packages some other package of the graph depends on. */
const dependedOn = (packages: readonly PackageNode[]): ReadonlySet<string> =>
  new Set(packages.flatMap((pkg) => pkg.deps.filter((dep) => dep !== pkg.id)));

/** Code-unit order of directories: no locale. */
const byDir = (a: PackageNode, b: PackageNode): number => {
  if (a.dir === b.dir) {
    return 0;
  }
  return a.dir < b.dir ? -1 : 1;
};

type ZoneIndex = {
  readonly zones: readonly Zone[];
  readonly byModule: ReadonlyMap<string, Zone>;
  readonly byId: ReadonlyMap<string, Zone>;
};

/** The graphs are immutable, so one index per graph is enough. */
const indexes = new WeakMap<CodeGraph, ZoneIndex>();

const indexOf = (graph: CodeGraph): ZoneIndex => {
  const cached = indexes.get(graph);
  if (cached !== undefined) {
    return cached;
  }
  const packages = graph.packages ?? [];
  const owned = new Map<PackageNode, ModuleNode[]>();
  const unowned: ModuleNode[] = [];
  for (const module of graph.modules) {
    const owner = owningPackage(packages, module.id);
    const group = owner === null ? unowned : owned.get(owner);
    if (group !== undefined) {
      group.push(module);
    } else if (owner !== null) {
      owned.set(owner, [module]);
    }
  }
  const depended = dependedOn(packages);
  const ordered = [...owned.keys()].toSorted(
    (a, b) =>
      Number(depended.has(a.id)) - Number(depended.has(b.id)) || byDir(a, b)
  );
  const zones: Zone[] = ordered.map((pkg) => ({
    id: zoneId(pkg.id),
    name: pkg.name,
    pkg,
    modules: owned.get(pkg) ?? [],
  }));
  if (unowned.length > 0) {
    zones.push({
      id: zoneId(null),
      name: repositoryName(graph),
      pkg: null,
      modules: unowned,
    });
  }
  const index: ZoneIndex = {
    zones,
    byModule: new Map(
      zones.flatMap((zone) => zone.modules.map((module) => [module.id, zone]))
    ),
    byId: new Map(zones.map((zone) => [zone.id, zone])),
  };
  indexes.set(graph, index);
  return index;
};

/**
 * The graph's zones: one per package that owns a module, packages no other
 * package depends on first (the apps, usually), then the rest, each by
 * directory; then one for the modules no package owns, named after the
 * repository. A graph without packages is one zone of every module.
 */
const zonesOf = (graph: CodeGraph): readonly Zone[] => indexOf(graph).zones;

/** Whether the graph has more than one zone, so the world needs zone hubs. */
const hasZones = (graph: CodeGraph): boolean => zonesOf(graph).length > 1;

/** The zone a module lies in, or null for ids not from this graph. */
const zoneOfModule = (graph: CodeGraph, moduleId: string): Zone | null =>
  indexOf(graph).byModule.get(moduleId) ?? null;

/** The zone a zone hub (any of its chain) belongs to, or null. */
const zoneOfHub = (graph: CodeGraph, roomId: string): Zone | null =>
  isZoneHub(roomId)
    ? (indexOf(graph).byId.get(hubModuleId(roomId)) ?? null)
    : null;

export { hasZones, isZoneHub, zoneId, zoneOfHub, zoneOfModule, zonesOf };
export type { Zone };
