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
  isParenthesizedExpression,
  isPrivateName,
  isSequenceExpression,
  isSuper,
  isTaggedTemplateExpression,
  isThisExpression,
  isTSAsExpression,
  isTSInstantiationExpression,
  isTSNonNullExpression,
  isTSSatisfiesExpression,
  isTSTypeAssertion,
  isYieldExpression,
} from "@babel/types";
import type { Node } from "@babel/types";
import type { CallKind, CallResolution } from "@repo/code-graph";

import { KNOWN_GLOBALS } from "./globals";
import type { ClassTable, DiscoveredFunction, Scope } from "./scope";

type Resolved = {
  readonly calleeName: string;
  readonly target: DiscoveredFunction | null;
  readonly resolution: CallResolution;
  /** For `ambiguous`: every function the call may reach, in source order. */
  readonly candidates?: readonly DiscoveredFunction[];
};

const unresolved = (calleeName: string): Resolved => ({
  calleeName,
  target: null,
  resolution: "unresolved",
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

/** The expression under TypeScript-only wrappers: `cb!`, `f as F`, `f<T>`. */
const unwrap = (node: Node): Node =>
  isTSNonNullExpression(node) ||
  isTSAsExpression(node) ||
  isTSSatisfiesExpression(node) ||
  isTSTypeAssertion(node) ||
  isTSInstantiationExpression(node) ||
  isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node;

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
 * call unresolved.
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
      return unresolved(name);
    }
  }
  return KNOWN_GLOBALS.has(name) ? external(name) : unresolved(name);
};

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

/** Any binding of the name between here and the module, inclusive. */
const shadowed = (name: string, scope: Scope): boolean => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    if (
      current.locals.has(name) ||
      current.classes.has(name) ||
      current.bindings.has(name)
    ) {
      return true;
    }
  }
  return false;
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
    return scope.isStatic && own !== null
      ? unresolved(name)
      : byMemberName(name, property, own, classes);
  }
  if (isIdentifier(object)) {
    const table = resolveClass(object.name, scope);
    if (table !== null) {
      const target = table.static.get(property);
      return target === undefined ? unresolved(name) : resolved(name, target);
    }
  }
  const root = rootIdentifier(object);
  return root !== null && KNOWN_GLOBALS.has(root) && !shadowed(root, scope)
    ? external(name)
    : byMemberName(name, property, own, classes);
};

const resolveNew = (callee: Node, scope: Scope): Resolved => {
  if (!isIdentifier(callee)) {
    return isMemberExpression(callee) || isOptionalMemberExpression(callee)
      ? unresolved(calleeText(callee))
      : otherCallee(callee);
  }
  const { name } = callee;
  const table = resolveClass(name, scope);
  if (table !== null) {
    return table.ctor === null ? unresolved(name) : resolved(name, table.ctor);
  }
  // `new Foo()` on a plain function: the function is the constructor.
  return resolveIdentifier(name, scope);
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
