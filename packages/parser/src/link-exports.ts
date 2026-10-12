// What the link pass follows an import to: the binding a module exports
// under a name, through re-exports, `export *` and namespaces, and the
// functions of a top-level class it finds there.

import type {
  ExportRecord,
  ImportRecord,
  ImportVia,
  ModuleNode,
} from "@repo/code-graph";
import type { Resolver } from "@repo/code-graph/module-resolver";

import type { DiscoveredFunction } from "./scope";
import type { TopLevel } from "./top-level";

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
  readonly resolve: Resolver;
  readonly modules: ReadonlyMap<string, ModuleNode>;
  readonly functions: ReadonlyMap<string, readonly DiscoveredFunction[]>;
  readonly topLevel: ReadonlyMap<string, TopLevel>;
  /** Linked, like the modules' own imports. */
  readonly typeImports: ReadonlyMap<string, readonly ImportRecord[]>;
  readonly typeExports: ReadonlyMap<string, readonly ExportRecord[]>;
};

/**
 * A module's imports and exports; with `types`, its type-only ones too,
 * after the others, for following a receiver's class (which a barrel may
 * re-export as a type only).
 */
const importsFor = (
  linker: Linker,
  module: ModuleNode,
  types: boolean
): readonly ImportRecord[] =>
  types
    ? [...module.imports, ...(linker.typeImports.get(module.id) ?? [])]
    : module.imports;

const exportsFor = (
  linker: Linker,
  module: ModuleNode,
  types: boolean
): readonly ExportRecord[] =>
  types
    ? [...module.exports, ...(linker.typeExports.get(module.id) ?? [])]
    : module.exports;

const importBinding = (
  linker: Linker,
  record: ImportRecord,
  seen: Set<string>,
  types = false
): Lookup => {
  if (record.moduleId === null || record.importedName === null) {
    return null;
  }
  return record.importedName === "*"
    ? { kind: "namespace", moduleId: record.moduleId }
    : exportOf(linker, record.moduleId, record.importedName, seen, types);
};

/** Distinct hits of the module's `export *` declarations, in source order. */
const starExports = (
  linker: Linker,
  module: ModuleNode,
  name: string,
  seen: Set<string>,
  types: boolean
): Lookup => {
  const hits = new Map<string, Binding>();
  for (const record of exportsFor(linker, module, types)) {
    if (record.exportedName !== "*" || record.specifier === null) {
      continue;
    }
    const target = linker.resolve(module.id, record.specifier);
    const found =
      target === null ? null : exportOf(linker, target, name, seen, types);
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
  seen: Set<string>,
  types = false
): Lookup => {
  const key = `${moduleId}\0${name}`;
  const module = linker.modules.get(moduleId);
  if (module === undefined || seen.has(key)) {
    return null;
  }
  seen.add(key);
  const record = exportsFor(linker, module, types).find(
    (item) => item.exportedName === name
  );
  if (record === undefined) {
    return name === "default"
      ? null
      : starExports(linker, module, name, seen, types);
  }
  if (record.specifier === null) {
    if (record.localName === null) {
      return null;
    }
    const imported = importsFor(linker, module, types).find(
      (item) => item.localName === record.localName
    );
    return imported === undefined
      ? { kind: "local", moduleId, localName: record.localName }
      : importBinding(linker, imported, seen, types);
  }
  const target = linker.resolve(moduleId, record.specifier);
  if (target === null || record.importedName === null) {
    return null;
  }
  return record.importedName === "*"
    ? { kind: "namespace", moduleId: target }
    : exportOf(linker, target, record.importedName, seen, types);
};

/** What the import a call goes through is bound to. */
const viaBindings = (
  linker: Linker,
  module: ModuleNode,
  via: ImportVia
): readonly Binding[] => {
  const types = via.instance === true;
  const record = importsFor(linker, module, types).find(
    (item) => item.localName === via.localName
  );
  return listOf(
    record === undefined
      ? null
      : importBinding(linker, record, new Set(), types)
  );
};

/** A function of the module's own top-level class `name`, not of a block's namesake. */
const memberOf = (
  linker: Linker,
  moduleId: string,
  name: string,
  test: (fn: DiscoveredFunction) => boolean
): DiscoveredFunction | undefined => {
  const range = linker.topLevel.get(moduleId)?.classes.get(name);
  return range === undefined
    ? undefined
    : (linker.functions.get(moduleId) ?? []).find(
        (fn) =>
          fn.className === name &&
          fn.parentId === null &&
          fn.span.start >= range.start &&
          fn.span.end <= range.end &&
          test(fn)
      );
};

/** An instance member (method, accessor or function field) by name. */
const isInstanceMember =
  (member: string) =>
  (fn: DiscoveredFunction): boolean =>
    !fn.isStatic && fn.kind !== "constructor" && fn.name === member;

export {
  exportOf,
  importBinding,
  isInstanceMember,
  listOf,
  memberOf,
  viaBindings,
};
export type { Binding, Linker };
