// Class hierarchies across files: a call on a receiver typed as a class may
// run a member inherited from an imported superclass, or any override of it
// in a subclass, both of which the per-file pass sees only within the
// module. The linker follows `extends` over the whole graph and indexes
// every top-level class's subclasses.

import type { CallSite, ModuleNode } from "@repo/code-graph";

import {
  importBinding,
  isInstanceMember,
  listOf,
  memberOf,
  viaBindings,
} from "./link-exports";
import type { Binding, Linker } from "./link-exports";
import type { Dispatch } from "./resolve";
import type { DiscoveredFunction } from "./scope";
import { MAX_LINEAGE } from "./scope-lookup";

/** A top-level class of a module. */
type ClassKey = { readonly moduleId: string; readonly name: string };

const classKey = ({ moduleId, name }: ClassKey): string =>
  `${moduleId}\0${name}`;

/** The top-level class one binding names, if it names exactly one. */
const classOf = (
  linker: Linker,
  bindings: readonly Binding[]
): ClassKey | null => {
  const [only, ...rest] = bindings;
  return only?.kind === "local" &&
    rest.length === 0 &&
    linker.topLevel.get(only.moduleId)?.classes.has(only.localName) === true
    ? { moduleId: only.moduleId, name: only.localName }
    : null;
};

/** The class a top-level class extends: one of its module, or an imported one. */
const parentOf = (
  linker: Linker,
  { moduleId, name }: ClassKey
): ClassKey | null => {
  const classes = linker.topLevel.get(moduleId)?.classes;
  const superName = classes?.get(name)?.superName ?? null;
  if (superName === null) {
    return null;
  }
  if (classes?.has(superName) === true) {
    return { moduleId, name: superName };
  }
  const record = linker.modules
    .get(moduleId)
    ?.imports.find((item) => item.localName === superName);
  return record === undefined
    ? null
    : classOf(linker, listOf(importBinding(linker, record, new Set())));
};

/**
 * An instance member of a top-level class or, unless private, of its
 * superclasses across the graph, nearest first.
 */
const inheritedMember = (
  linker: Linker,
  key: ClassKey,
  member: string
): DiscoveredFunction | undefined => {
  const seen = new Set<string>();
  for (
    let current: ClassKey | null = key;
    current !== null && seen.size < MAX_LINEAGE;
    current = member.startsWith("#") ? null : parentOf(linker, current)
  ) {
    if (seen.has(classKey(current))) {
      return undefined;
    }
    seen.add(classKey(current));
    const fn = memberOf(
      linker,
      current.moduleId,
      current.name,
      isInstanceMember(member)
    );
    if (fn !== undefined) {
      return fn;
    }
  }
  return undefined;
};

type SubclassIndex = ReadonlyMap<string, readonly ClassKey[]>;

/**
 * Every top-level class's subclasses, at any depth, across the graph, in
 * module then source order.
 */
const subclassIndex = (linker: Linker): SubclassIndex => {
  const index = new Map<string, ClassKey[]>();
  for (const [moduleId, topLevel] of linker.topLevel) {
    for (const name of topLevel.classes.keys()) {
      const self = { moduleId, name };
      const seen = new Set([classKey(self)]);
      for (
        let parent = parentOf(linker, self);
        parent !== null && seen.size <= MAX_LINEAGE;
        parent = parentOf(linker, parent)
      ) {
        const key = classKey(parent);
        if (seen.has(key)) {
          break;
        }
        seen.add(key);
        index.set(key, [...(index.get(key) ?? []), self]);
      }
    }
  }
  return index;
};

/**
 * Completes a call on a typed receiver across files: a member the class
 * inherits from an imported superclass, which the per-file pass cannot
 * see, then, unless the receiver is exact, every override of the member in
 * a subclass anywhere in the graph (a subclass instance may stand where
 * the class is named). One function stays resolved, more make the call
 * ambiguous.
 */
const withOverrides = (
  linker: Linker,
  subclasses: SubclassIndex,
  module: ModuleNode,
  site: CallSite,
  dispatch: Dispatch
): CallSite => {
  let base: ClassKey | null = null;
  if (dispatch.className !== null) {
    base = { moduleId: module.id, name: dispatch.className };
  } else if (site.via !== undefined) {
    base = classOf(linker, viaBindings(linker, module, site.via));
  }
  if (base === null) {
    return site;
  }
  const { member } = dispatch;
  const overrides =
    dispatch.exact || member.startsWith("#")
      ? []
      : (subclasses.get(classKey(base)) ?? []).flatMap((sub) => {
          const fn = memberOf(
            linker,
            sub.moduleId,
            sub.name,
            isInstanceMember(member)
          );
          return fn === undefined ? [] : [fn.id];
        });
  let before: readonly string[] = [];
  if (site.resolution === "resolved" && site.calleeId !== null) {
    before = [site.calleeId];
  } else if (site.resolution === "ambiguous") {
    before = site.candidateIds ?? [];
  }
  // The class's own member if it has one, which `before` already holds.
  const inherited = inheritedMember(linker, base, member);
  const ids = [
    ...new Set([
      ...before,
      ...(inherited === undefined ? [] : [inherited.id]),
      ...overrides,
    ]),
  ];
  const [only, ...rest] = ids;
  if (ids.length === before.length || only === undefined) {
    return site;
  }
  return rest.length === 0
    ? { ...site, resolution: "resolved", calleeId: only }
    : { ...site, resolution: "ambiguous", calleeId: null, candidateIds: ids };
};

export { inheritedMember, subclassIndex, withOverrides };
