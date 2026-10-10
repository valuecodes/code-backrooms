// Link pass: follows each module's imports into the other modules of the
// graph, so a call through an import (`via`, left unresolved by the per-file
// pass) can name the function it reaches. Relative specifiers only: a
// package import stays unresolved and keeps `via`, which is how the HUD
// tells a library call from one the analysis could not follow.

import type {
  CallEdge,
  CallSite,
  GraphEdge,
  ImportRecord,
  ModuleNode,
} from "@repo/code-graph";
import { resolveSpecifier } from "@repo/code-graph/ids";

import type { DiscoveredFunction } from "./scope";

/** What the linker reads and rewrites of one analysed module. */
type Linkable = {
  readonly module: ModuleNode;
  /** In source order. */
  readonly functions: readonly DiscoveredFunction[];
  readonly callSites: readonly CallSite[];
  readonly edges: readonly GraphEdge[];
};

/** A top-level binding of a module, or a whole module as a namespace object. */
type Binding =
  | {
      readonly kind: "local";
      readonly moduleId: string;
      readonly localName: string;
    }
  | { readonly kind: "namespace"; readonly moduleId: string };

/** One binding, several (`export *` from modules that clash), or nothing. */
type Lookup = Binding | readonly Binding[] | null;

const listOf = (lookup: Lookup): readonly Binding[] => {
  if (lookup === null) {
    return [];
  }
  return "kind" in lookup ? [lookup] : lookup;
};

const bindingKey = (binding: Binding): string =>
  binding.kind === "local"
    ? `${binding.moduleId}\0${binding.localName}`
    : binding.moduleId;

type Linker = {
  readonly ids: ReadonlySet<string>;
  readonly modules: ReadonlyMap<string, ModuleNode>;
  readonly functions: ReadonlyMap<string, readonly DiscoveredFunction[]>;
};

const importBinding = (
  linker: Linker,
  record: ImportRecord,
  seen: Set<string>
): Lookup => {
  if (record.moduleId === null || record.importedName === null) {
    return null;
  }
  return record.importedName === "*"
    ? { kind: "namespace", moduleId: record.moduleId }
    : exportOf(linker, record.moduleId, record.importedName, seen);
};

/** Distinct hits of the module's `export *` declarations, in source order. */
const starExports = (
  linker: Linker,
  module: ModuleNode,
  name: string,
  seen: Set<string>
): Lookup => {
  const hits = new Map<string, Binding>();
  for (const record of module.exports) {
    if (record.exportedName !== "*" || record.specifier === null) {
      continue;
    }
    const target = resolveSpecifier(module.id, record.specifier, linker.ids);
    const found = target === null ? null : exportOf(linker, target, name, seen);
    for (const binding of listOf(found)) {
      hits.set(bindingKey(binding), binding);
    }
  }
  const all = [...hits.values()];
  return all.length <= 1 ? (all[0] ?? null) : all;
};

/**
 * What `name` exported from `moduleId` is bound to. A named export wins over
 * `export *` (which never carries `default`); a local export that is itself
 * an import is followed; `seen` stops re-export cycles.
 */
const exportOf = (
  linker: Linker,
  moduleId: string,
  name: string,
  seen: Set<string>
): Lookup => {
  const key = `${moduleId}\0${name}`;
  const module = linker.modules.get(moduleId);
  if (module === undefined || seen.has(key)) {
    return null;
  }
  seen.add(key);
  const record = module.exports.find((item) => item.exportedName === name);
  if (record === undefined) {
    return name === "default" ? null : starExports(linker, module, name, seen);
  }
  if (record.specifier === null) {
    if (record.localName === null) {
      return null;
    }
    const imported = module.imports.find(
      (item) => item.localName === record.localName
    );
    return imported === undefined
      ? { kind: "local", moduleId, localName: record.localName }
      : importBinding(linker, imported, seen);
  }
  const target = resolveSpecifier(moduleId, record.specifier, linker.ids);
  if (target === null || record.importedName === null) {
    return null;
  }
  return record.importedName === "*"
    ? { kind: "namespace", moduleId: target }
    : exportOf(linker, target, record.importedName, seen);
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
 * member a static method of a top-level class. Null for anything else,
 * a namespace called directly included.
 */
const functionOf = (
  linker: Linker,
  { binding, member }: Callee,
  isNew: boolean
): DiscoveredFunction | null => {
  if (binding.kind === "namespace") {
    return null;
  }
  const topLevel = (linker.functions.get(binding.moduleId) ?? []).filter(
    (fn) => fn.parentId === null
  );
  const name = binding.localName;
  if (member !== null) {
    return isNew
      ? null
      : (topLevel.find(
          (fn) =>
            fn.className === name &&
            fn.isStatic &&
            fn.qualifiedName === `${name}.${member}`
        ) ?? null);
  }
  const plain =
    topLevel.find((fn) => fn.className === null && fn.qualifiedName === name) ??
    null;
  if (!isNew) {
    return plain;
  }
  return (
    topLevel.find((fn) => fn.className === name && fn.kind === "constructor") ??
    plain
  );
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
  const record = module.imports.find(
    (item) => item.localName === via.localName
  );
  const found =
    record === undefined ? null : importBinding(linker, record, new Set());
  const callees = listOf(found).flatMap((binding) =>
    calleesOf(linker, binding, via.member)
  );
  const targets = new Map<string, DiscoveredFunction>();
  for (const callee of callees) {
    const fn = functionOf(linker, callee, via.isNew);
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

/** Adds a call edge per newly resolved site whose caller is a function. */
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
    if (
      site.calleeId === null ||
      before?.resolution === "resolved" ||
      site.callerId === unit.module.id
    ) {
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
  return edges;
};

/**
 * Resolves every import's module and every call through an import. Pure and
 * deterministic: the result depends only on the units, in their order.
 */
const linkModules = <T extends Linkable>(units: readonly T[]): readonly T[] => {
  const ids = new Set(units.map((unit) => unit.module.id));
  const modules = new Map(
    units.map((unit): [string, ModuleNode] => [
      unit.module.id,
      {
        ...unit.module,
        imports: unit.module.imports.map((record) => ({
          ...record,
          moduleId: resolveSpecifier(unit.module.id, record.specifier, ids),
        })),
      },
    ])
  );
  const linker: Linker = {
    ids,
    modules,
    functions: new Map(units.map((unit) => [unit.module.id, unit.functions])),
  };
  return units.map((unit) => {
    const module = modules.get(unit.module.id) ?? unit.module;
    const callSites = unit.callSites.map((site) =>
      linkSite(linker, module, site)
    );
    return { ...unit, module, callSites, edges: withEdges(unit, callSites) };
  });
};

export { linkModules };
