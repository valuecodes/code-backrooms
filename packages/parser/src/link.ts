// Link pass: follows each module's imports into the other modules of the
// graph, so a call through an import (`via`, left unresolved by the per-file
// pass) can name the function it reaches. Specifiers resolve as relative
// paths, as tsconfig `paths` aliases of the importer's package (`~/hud`) and
// as workspace packages by name through their `exports` (`@repo/x/sub`);
// see module-resolver.ts for what is out of scope. An import of anything
// else (npm packages, `node:` builtins) stays unresolved and keeps `via`,
// which is how the HUD tells a library call from one the analysis could not
// follow. Calls on typed receivers are widened by overrides in other files
// (link-overrides.ts).

import type {
  CallEdge,
  CallSite,
  ExportRecord,
  GraphEdge,
  ImportRecord,
  ModuleNode,
  PackageNode,
} from "@repo/code-graph";
import { createResolver } from "@repo/code-graph/module-resolver";

import { exportOf, listOf, memberOf, viaBindings } from "./link-exports";
import type { Binding, Linker } from "./link-exports";
import {
  inheritedMember,
  subclassIndex,
  withOverrides,
} from "./link-overrides";
import type { Dispatch } from "./resolve";
import type { DiscoveredFunction } from "./scope";
import type { TopLevel } from "./top-level";

/** What the linker reads and rewrites of one analysed module. */
type Linkable = {
  readonly module: ModuleNode;
  /** In source order. */
  readonly functions: readonly DiscoveredFunction[];
  /** The module's own bindings, which an importer reaches. */
  readonly topLevel: TopLevel;
  readonly callSites: readonly CallSite[];
  readonly edges: readonly GraphEdge[];
  /**
   * Type-only imports and exports, never on the module: followed only to
   * the class of a typed receiver (`via.instance`).
   */
  readonly typeImports: readonly ImportRecord[];
  readonly typeExports: readonly ExportRecord[];
  /** By call site id: calls on typed receivers that subclasses may override. */
  readonly dispatch: ReadonlyMap<string, Dispatch>;
};

/** A binding and the member called on it, if any. */
type Callee = { readonly binding: Binding; readonly member: string | null };

/**
 * `ns.f()` names whatever the namespace's module exports as `f` (possibly
 * several bindings, when stars clash); anything else is called as written.
 */
const calleesOf = (
  linker: Linker,
  binding: Binding,
  member: string | null
): readonly Callee[] =>
  binding.kind === "namespace" && member !== null
    ? listOf(exportOf(linker, binding.moduleId, member, new Set())).map(
        (inner) => ({ binding: inner, member: null })
      )
    : [{ binding, member }];

/**
 * The function a binding calls: a top-level plain function, `new` on a
 * top-level class (its constructor) or on a plain function, or with a
 * member a static method of a top-level class, or with `instance` an
 * instance member of one or of its superclasses. Null for anything else, a namespace called
 * directly included.
 */
const functionOf = (
  linker: Linker,
  { binding, member }: Callee,
  isNew: boolean,
  instance: boolean
): DiscoveredFunction | null => {
  if (binding.kind === "namespace") {
    return null;
  }
  const name = binding.localName;
  const plain = linker.topLevel.get(binding.moduleId)?.functions.get(name);
  const ofClass = (test: (fn: DiscoveredFunction) => boolean) =>
    memberOf(linker, binding.moduleId, name, test);
  if (member !== null) {
    if (isNew) {
      return null;
    }
    return (
      (instance
        ? inheritedMember(linker, { moduleId: binding.moduleId, name }, member)
        : ofClass((fn) => fn.isStatic && fn.name === member)) ?? null
    );
  }
  if (!isNew) {
    return plain ?? null;
  }
  return ofClass((fn) => fn.kind === "constructor") ?? plain ?? null;
};

/** Rewrites one site through its import, or returns it unchanged. */
const linkSite = (
  linker: Linker,
  module: ModuleNode,
  site: CallSite
): CallSite => {
  const { via } = site;
  if (via === undefined || site.resolution !== "unresolved") {
    return site;
  }
  const instance = via.instance === true;
  const bindings = viaBindings(linker, module, via);
  // A receiver's class is called on as it is, never as a namespace.
  const callees = instance
    ? bindings.map((binding) => ({ binding, member: via.member }))
    : bindings.flatMap((binding) => calleesOf(linker, binding, via.member));
  const targets = new Map<string, DiscoveredFunction>();
  for (const callee of callees) {
    const fn = functionOf(linker, callee, via.isNew, instance);
    if (fn !== null) {
      targets.set(fn.id, fn);
    }
  }
  const [only, ...others] = targets.values();
  // A name clashing stars bind to a function and to something else is still
  // ambiguous, but with one candidate there is nothing to list: unresolved.
  if (only === undefined || (others.length === 0 && callees.length > 1)) {
    return site;
  }
  if (others.length === 0) {
    return { ...site, resolution: "resolved", calleeId: only.id };
  }
  return {
    ...site,
    resolution: "ambiguous",
    candidateIds: [...targets.keys()],
  };
};

/**
 * Adds a call edge per newly resolved site whose caller is a function, and
 * takes a site off the edge it no longer resolves along.
 */
const withEdges = (
  unit: Linkable,
  sites: readonly CallSite[]
): readonly GraphEdge[] => {
  const edges = [...unit.edges];
  const index = new Map<string, number>();
  edges.forEach((edge, position) => {
    if (edge.type === "call") {
      index.set(`${edge.source}->${edge.target}`, position);
    }
  });
  sites.forEach((site, position) => {
    const before = unit.callSites[position];
    const was = before?.resolution === "resolved" ? before.calleeId : null;
    if (site.calleeId === was || site.callerId === unit.module.id) {
      return;
    }
    // Overrides found across files turned a resolved call ambiguous.
    const old =
      was === null ? undefined : index.get(`${site.callerId}->${was}`);
    const stale = old === undefined ? undefined : edges[old];
    if (old !== undefined && stale?.type === "call") {
      edges[old] = {
        ...stale,
        callSiteIds: stale.callSiteIds.filter((id) => id !== site.id),
      };
    }
    if (site.calleeId === null) {
      return;
    }
    const key = `${site.callerId}->${site.calleeId}`;
    const at = index.get(key);
    const existing = at === undefined ? undefined : edges[at];
    if (at !== undefined && existing?.type === "call") {
      edges[at] = {
        ...existing,
        callSiteIds: [...existing.callSiteIds, site.id],
      };
      return;
    }
    const edge: CallEdge = {
      type: "call",
      source: site.callerId,
      target: site.calleeId,
      callSiteIds: [site.id],
    };
    index.set(key, edges.length);
    edges.push(edge);
  });
  return edges.filter(
    (edge) => edge.type !== "call" || edge.callSiteIds.length > 0
  );
};

/**
 * Resolves every import's module and every call through an import, bare
 * specifiers through `packages`. Pure and deterministic: the result depends
 * only on the units, in their order, and the packages.
 */
const linkModules = <T extends Linkable>(
  units: readonly T[],
  packages: readonly PackageNode[] = []
): readonly T[] => {
  const resolve = createResolver(
    new Set(units.map((unit) => unit.module.id)),
    packages
  );
  const linked = (moduleId: string, records: readonly ImportRecord[]) =>
    records.map((record) => ({
      ...record,
      moduleId: resolve(moduleId, record.specifier),
    }));
  const modules = new Map(
    units.map((unit): [string, ModuleNode] => [
      unit.module.id,
      { ...unit.module, imports: linked(unit.module.id, unit.module.imports) },
    ])
  );
  const linker: Linker = {
    resolve,
    modules,
    functions: new Map(units.map((unit) => [unit.module.id, unit.functions])),
    topLevel: new Map(units.map((unit) => [unit.module.id, unit.topLevel])),
    typeImports: new Map(
      units.map((unit) => [
        unit.module.id,
        linked(unit.module.id, unit.typeImports),
      ])
    ),
    typeExports: new Map(
      units.map((unit) => [unit.module.id, unit.typeExports])
    ),
  };
  const subclasses = subclassIndex(linker);
  return units.map((unit) => {
    const module = modules.get(unit.module.id) ?? unit.module;
    const callSites = unit.callSites.map((site) => {
      const next = linkSite(linker, module, site);
      const dispatch = unit.dispatch.get(site.id);
      return dispatch === undefined
        ? next
        : withOverrides(linker, subclasses, module, next, dispatch);
    });
    return { ...unit, module, callSites, edges: withEdges(unit, callSites) };
  });
};

export { linkModules };
