// Resolution rules for one callee: resolved, ambiguous, dynamic, external
// or unresolved (see CallResolution), by name against the lexical scopes
// the discovery pass built.

import {
  isAssignmentExpression,
  isAwaitExpression,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isLogicalExpression,
  isMemberExpression,
  isNewExpression,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isPrivateName,
  isSequenceExpression,
  isSuper,
  isTaggedTemplateExpression,
  isThisExpression,
  isYieldExpression,
} from "@babel/types";
import type { Node } from "@babel/types";
import type { CallKind, CallResolution, ImportVia } from "@repo/code-graph";

import { KNOWN_GLOBALS } from "./globals";
import { unwrap } from "./scope";
import type { ClassTable, DiscoveredFunction, Scope } from "./scope";
import {
  fieldType,
  instanceMember,
  isImport,
  isTypeImport,
  overridesOf,
  receiverType,
  resolveClass,
  shadowed,
} from "./scope-lookup";
import type { Receiver } from "./scope-lookup";

/**
 * A method called on a receiver typed as a top-level class of this module
 * (`className`) or an imported one (`via.instance`, `className` null): a
 * subclass in another file may override `member`, which only the linker
 * sees.
 */
type Dispatch = { readonly className: string | null; readonly member: string };

type Resolved = {
  readonly calleeName: string;
  readonly target: DiscoveredFunction | null;
  readonly resolution: CallResolution;
  /** For `ambiguous`: every function the call may reach, in source order. */
  readonly candidates?: readonly DiscoveredFunction[];
  /** Set when the callee is an import binding; the call stays unresolved. */
  readonly via?: ImportVia;
  readonly dispatch?: Dispatch;
};

const unresolved = (calleeName: string): Resolved => ({
  calleeName,
  target: null,
  resolution: "unresolved",
});

/** A call through an import: left for the cross-file linker. */
const imported = (calleeName: string, via: ImportVia): Resolved => ({
  calleeName,
  target: null,
  resolution: "unresolved",
  via,
});

const external = (calleeName: string): Resolved => ({
  calleeName,
  target: null,
  resolution: "external",
});

const resolved = (
  calleeName: string,
  target: DiscoveredFunction
): Resolved => ({
  calleeName,
  target,
  resolution: "resolved",
});

const dynamic = (calleeName: string): Resolved => ({
  calleeName,
  target: null,
  resolution: "dynamic",
});

/**
 * One function resolves; several make the call ambiguous (none of them is
 * followed); none leaves it unresolved.
 */
const amongst = (
  calleeName: string,
  functions: readonly DiscoveredFunction[]
): Resolved => {
  const [only, ...rest] = functions;
  if (only === undefined) {
    return unresolved(calleeName);
  }
  if (rest.length === 0) {
    return resolved(calleeName, only);
  }
  return {
    calleeName,
    target: null,
    resolution: "ambiguous",
    candidates: functions.toSorted((a, b) => a.span.start - b.span.start),
  };
};

/** Source-like text for a callee the analysis cannot follow. */
const calleeText = (raw: Node): string => {
  const node = unwrap(raw);
  if (isIdentifier(node)) {
    return node.name;
  }
  if (isThisExpression(node)) {
    return "this";
  }
  if (isSuper(node)) {
    return "super";
  }
  if (isPrivateName(node)) {
    return `#${node.id.name}`;
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    const property = node.computed ? "[…]" : `.${calleeText(node.property)}`;
    return `${calleeText(node.object)}${property}`;
  }
  if (isCallExpression(node) || isOptionalCallExpression(node)) {
    return `${calleeText(node.callee)}(…)`;
  }
  return `<${node.type}>`;
};

/** The leftmost identifier of a member chain, if it is one. */
const rootIdentifier = (raw: Node): string | null => {
  const node = unwrap(raw);
  if (isIdentifier(node)) {
    return node.name;
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    return rootIdentifier(node.object);
  }
  return null;
};

/**
 * Walks outwards: a named function in a scope resolves, several of the same
 * name make the call ambiguous (block scopes are folded into their
 * function, so each branch declaring one adds a candidate); a parameter
 * makes it dynamic (a callback); any other binding of the name (a
 * variable, import or class) shadows everything further out and makes the
 * call unresolved, carrying `via` when that binding is an import.
 */
const resolveIdentifier = (name: string, scope: Scope): Resolved => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    const local = current.locals.get(name);
    if (local !== undefined) {
      return amongst(name, local);
    }
    if (current.params.has(name)) {
      return dynamic(name);
    }
    if (current.bindings.has(name)) {
      return current.imports.has(name)
        ? imported(name, { localName: name, member: null, isNew: false })
        : unresolved(name);
    }
  }
  return KNOWN_GLOBALS.has(name) ? external(name) : unresolved(name);
};

/**
 * `x.m()` on a receiver whose class is known by name. A class of this
 * module resolves to its member (or an inherited one) and to every
 * override in its subclasses here: one function resolves, several are
 * ambiguous, none leaves the call unresolved rather than guessing by name.
 * An imported class is left to the linker. Anything else (an interface, a
 * type alias, a global like `Map`) is not a class this can follow: null.
 * The annotation is taken as the contract, as an editor's go-to-definition
 * does; an object of another class that merely fits it is not considered.
 */
const typedReceiver = (
  name: string,
  property: string,
  { type, scope }: Receiver,
  classes: readonly ClassTable[]
): Resolved | null => {
  const table = resolveClass(type.name, scope);
  if (table !== null) {
    const own = instanceMember(table, property);
    const result = amongst(name, [
      ...(own === undefined ? [] : [own]),
      ...(type.exact ? [] : overridesOf(table, property, classes)),
    ]);
    // Only a top-level class can be extended from another file.
    return table.scope.parent === null
      ? {
          ...result,
          ...(type.exact
            ? {}
            : { dispatch: { className: table.name, member: property } }),
        }
      : result;
  }
  if (isImport(type.name, scope) || isTypeImport(type.name, scope)) {
    return {
      ...imported(name, {
        localName: type.name,
        member: property,
        isNew: false,
        instance: true,
      }),
      ...(type.exact
        ? {}
        : { dispatch: { className: null, member: property } }),
    };
  }
  return null;
};

/** The name a non-computed member access reaches for, `#x` for private. */
const propertyName = (property: Node): string | null => {
  if (isPrivateName(property)) {
    return `#${property.id.name}`;
  }
  return isIdentifier(property) ? property.name : null;
};

/**
 * A member call on a receiver the analysis cannot type: ambiguous when
 * classes of the module declare two or more instance members of that name
 * (a `#private` one only counts on `own`, the class `this` is in), else
 * unresolved. One candidate is still a guess about the receiver.
 */
const byMemberName = (
  name: string,
  property: string,
  own: ClassTable | null,
  classes: readonly ClassTable[]
): Resolved => {
  const candidates = classes.flatMap((table) => {
    const fn =
      property.startsWith("#") && table !== own
        ? undefined
        : table.instance.get(property);
    return fn === undefined ? [] : [fn];
  });
  return candidates.length >= 2 ? amongst(name, candidates) : unresolved(name);
};

/**
 * Callees that are neither names nor member accesses: computed at run time
 * (`f()()`, `(a || b)()`, `(await load)()`) is dynamic; `super(…)` and an
 * IIFE, whose body is already this room's, unresolved.
 */
const otherCallee = (callee: Node): Resolved => {
  const name = calleeText(callee);
  return isCallExpression(callee) ||
    isOptionalCallExpression(callee) ||
    isNewExpression(callee) ||
    isConditionalExpression(callee) ||
    isLogicalExpression(callee) ||
    isSequenceExpression(callee) ||
    isAssignmentExpression(callee) ||
    isAwaitExpression(callee) ||
    isYieldExpression(callee) ||
    isTaggedTemplateExpression(callee)
    ? dynamic(name)
    : unresolved(name);
};

/** The class of `this.field` (or `this.#field`) in an instance member. */
const thisField = (object: Node, scope: Scope): Receiver | null => {
  const own = scope.classTable;
  if (
    own === null ||
    scope.isStatic ||
    !(isMemberExpression(object) || isOptionalMemberExpression(object)) ||
    object.computed ||
    !isThisExpression(unwrap(object.object))
  ) {
    return null;
  }
  const field = propertyName(object.property);
  return field === null ? null : fieldType(own, field);
};

const resolveMember = (
  callee: Node,
  scope: Scope,
  classes: readonly ClassTable[]
): Resolved => {
  if (!(isMemberExpression(callee) || isOptionalMemberExpression(callee))) {
    return otherCallee(callee);
  }
  const name = calleeText(callee);
  if (callee.computed) {
    return dynamic(name);
  }
  const property = propertyName(callee.property);
  if (property === null) {
    return unresolved(name);
  }
  const object = unwrap(callee.object);
  const own = scope.classTable;
  if (isSuper(object)) {
    return unresolved(name);
  }
  if (isThisExpression(object)) {
    const target = (scope.isStatic ? own?.static : own?.instance)?.get(
      property
    );
    if (target !== undefined) {
      return resolved(name, target);
    }
    // A static `this` is a class (or a subclass): instance members do not apply.
    if (scope.isStatic && own !== null) {
      return unresolved(name);
    }
    const inherited = own === null ? undefined : instanceMember(own, property);
    return inherited === undefined
      ? byMemberName(name, property, own, classes)
      : resolved(name, inherited);
  }
  if (isIdentifier(object)) {
    const table = resolveClass(object.name, scope);
    if (table !== null) {
      const target = table.static.get(property);
      return target === undefined ? unresolved(name) : resolved(name, target);
    }
    if (isImport(object.name, scope)) {
      return imported(name, {
        localName: object.name,
        member: property,
        isNew: false,
      });
    }
  }
  const receiver = isIdentifier(object)
    ? receiverType(object.name, scope)
    : thisField(object, scope);
  const typed =
    receiver === null ? null : typedReceiver(name, property, receiver, classes);
  if (typed !== null) {
    return typed;
  }
  const root = rootIdentifier(object);
  return root !== null && KNOWN_GLOBALS.has(root) && !shadowed(root, scope)
    ? external(name)
    : byMemberName(name, property, own, classes);
};

const resolveNew = (callee: Node, scope: Scope): Resolved => {
  if (isMemberExpression(callee) || isOptionalMemberExpression(callee)) {
    // `new ns.Svc()`: one member access on an import is still linkable.
    const object = unwrap(callee.object);
    const property = callee.computed ? null : propertyName(callee.property);
    return isIdentifier(object) &&
      property !== null &&
      isImport(object.name, scope)
      ? imported(calleeText(callee), {
          localName: object.name,
          member: property,
          isNew: true,
        })
      : unresolved(calleeText(callee));
  }
  if (!isIdentifier(callee)) {
    return otherCallee(callee);
  }
  const { name } = callee;
  const table = resolveClass(name, scope);
  if (table !== null) {
    return table.ctor === null ? unresolved(name) : resolved(name, table.ctor);
  }
  // `new Foo()` on a plain function: the function is the constructor.
  const plain = resolveIdentifier(name, scope);
  return plain.via === undefined
    ? plain
    : { ...plain, via: { ...plain.via, isNew: true } };
};

const resolveCallee = (
  kind: CallKind,
  raw: Node,
  scope: Scope,
  classes: readonly ClassTable[]
): Resolved => {
  const callee = unwrap(raw);
  if (kind === "new") {
    return resolveNew(callee, scope);
  }
  if (isIdentifier(callee)) {
    return resolveIdentifier(callee.name, scope);
  }
  return resolveMember(callee, scope, classes);
};

export { resolveCallee };
export type { Dispatch };
