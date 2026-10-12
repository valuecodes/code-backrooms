// What a name means in a lexical scope, and what a class table holds along
// its `extends` chain: the lookups call resolution is built on.

import type {
  ClassTable,
  DiscoveredFunction,
  ReceiverType,
  Scope,
} from "./scope";

/** Whether some binding of `name` in this one scope hides the outer ones. */
const bindsHere = (current: Scope, name: string): boolean =>
  current.locals.has(name) ||
  current.classes.has(name) ||
  current.bindings.has(name);

/** The class a name refers to here, or null if it is not one (or shadowed). */
const resolveClass = (name: string, scope: Scope): ClassTable | null => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    const table = current.classes.get(name);
    if (table !== undefined) {
      return table;
    }
    if (current.locals.has(name) || current.bindings.has(name)) {
      return null;
    }
  }
  return null;
};

/** Whether the name refers to an import binding here (not shadowed). */
const isImport = (name: string, scope: Scope): boolean => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    if (current.imports.has(name)) {
      return true;
    }
    if (bindsHere(current, name)) {
      return false;
    }
  }
  return false;
};

/** Whether the name refers to a type-only import here (not shadowed). */
const isTypeImport = (name: string, scope: Scope): boolean => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    if (current.typeImports.has(name)) {
      return true;
    }
    if (bindsHere(current, name)) {
      return false;
    }
  }
  return false;
};

/** Any binding of the name between here and the module, inclusive. */
const shadowed = (name: string, scope: Scope): boolean => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    if (bindsHere(current, name)) {
      return true;
    }
  }
  return false;
};

/** A receiver's class and the scope its name resolves from. */
type Receiver = { readonly type: ReceiverType; readonly scope: Scope };

/** The class the binding `name` holds here, where its declaration says. */
const receiverType = (name: string, scope: Scope): Receiver | null => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    if (bindsHere(current, name)) {
      const type = current.types.get(name);
      return type === undefined || type === null
        ? null
        : { type, scope: current };
    }
  }
  return null;
};

/** Deep enough for any real hierarchy; a longer chain is left alone. */
const MAX_LINEAGE = 16;

/**
 * The class, then its superclasses nearest first, as far as each `extends`
 * names a class of this module; a cycle or an imported superclass ends it.
 */
const lineage = (table: ClassTable): readonly ClassTable[] => {
  const chain = [table];
  let current = table;
  while (current.superName !== null && chain.length < MAX_LINEAGE) {
    const parent = resolveClass(current.superName, current.scope);
    if (parent === null || chain.includes(parent)) {
      break;
    }
    chain.push(parent);
    current = parent;
  }
  return chain;
};

/** An instance member of the class or, unless private, of a superclass. */
const instanceMember = (
  table: ClassTable,
  member: string
): DiscoveredFunction | undefined => {
  const chain = member.startsWith("#") ? [table] : lineage(table);
  for (const current of chain) {
    const fn = current.instance.get(member);
    if (fn !== undefined) {
      return fn;
    }
  }
  return undefined;
};

/**
 * The members of the module's subclasses of `base` that override `member`,
 * each of which an instance typed `base` may run instead. Private members
 * are never overridden.
 */
const overridesOf = (
  base: ClassTable,
  member: string,
  classes: readonly ClassTable[]
): readonly DiscoveredFunction[] =>
  member.startsWith("#")
    ? []
    : classes.flatMap((table) => {
        const fn = table.instance.get(member);
        return table !== base &&
          fn !== undefined &&
          lineage(table).includes(base)
          ? [fn]
          : [];
      });

/**
 * The class of `this.field`: the first class along the lineage that
 * declares the field decides, even when it declares it without a type.
 */
const fieldType = (table: ClassTable, field: string): Receiver | null => {
  const chain = field.startsWith("#") ? [table] : lineage(table);
  for (const current of chain) {
    if (current.fields.has(field)) {
      const type = current.fields.get(field);
      return type === undefined || type === null
        ? null
        : { type, scope: current.scope };
    }
  }
  return null;
};

export {
  fieldType,
  instanceMember,
  isImport,
  isTypeImport,
  MAX_LINEAGE,
  overridesOf,
  receiverType,
  resolveClass,
  shadowed,
};
export type { Receiver };
