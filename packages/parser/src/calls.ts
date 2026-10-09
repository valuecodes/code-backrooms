// Call pass: every call, `new` and optional call inside each function (and at
// module level), resolved by name against the discovered lexical scopes.

import {
  isAwaitExpression,
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  isNewExpression,
  isOptionalCallExpression,
  isOptionalMemberExpression,
  isPrivateName,
  isSuper,
  isThisExpression,
} from "@babel/types";
import type { Node } from "@babel/types";
import type {
  CallEdge,
  CallKind,
  CallResolution,
  CallSite,
} from "@repo/code-graph";
import { callSiteId } from "@repo/code-graph/ids";

import type { Discovered } from "./functions";
import { KNOWN_GLOBALS } from "./globals";
import type { ClassTable, DiscoveredFunction, Scope } from "./scope";
import { spanOf } from "./span";
import { childrenOf, guardDepth } from "./walk";

type Resolved = {
  readonly calleeName: string;
  readonly target: DiscoveredFunction | null;
  readonly resolution: CallResolution;
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

/** Source-like text for a callee the analysis cannot follow. */
const calleeText = (node: Node): string => {
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
  return `<${node.type}>`;
};

/** The leftmost identifier of a member chain, if it is one. */
const rootIdentifier = (node: Node): string | null => {
  if (isIdentifier(node)) {
    return node.name;
  }
  if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
    return rootIdentifier(node.object);
  }
  return null;
};

/**
 * Walks outwards: a named function in a scope resolves; any other binding of
 * the same name (a parameter, variable, import or class) shadows everything
 * further out and makes the call unresolved. Block scopes are folded into
 * their function, so a binding anywhere in the function shadows.
 */
const resolveIdentifier = (name: string, scope: Scope): Resolved => {
  for (
    let current: Scope | null = scope;
    current !== null;
    current = current.parent
  ) {
    const local = current.locals.get(name);
    if (local !== undefined) {
      return resolved(name, local);
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

const resolveMember = (callee: Node, scope: Scope): Resolved => {
  if (
    !(isMemberExpression(callee) || isOptionalMemberExpression(callee)) ||
    callee.computed
  ) {
    return unresolved(calleeText(callee));
  }
  const name = calleeText(callee);
  const property = propertyName(callee.property);
  if (property === null) {
    return unresolved(name);
  }
  const { object } = callee;
  if (isThisExpression(object)) {
    const table = scope.classTable;
    const target = (scope.isStatic ? table?.static : table?.instance)?.get(
      property
    );
    return target === undefined ? unresolved(name) : resolved(name, target);
  }
  if (isIdentifier(object)) {
    const table = resolveClass(object.name, scope);
    if (table !== null) {
      const target = table.static.get(property);
      return target === undefined ? unresolved(name) : resolved(name, target);
    }
    return KNOWN_GLOBALS.has(object.name) && !shadowed(object.name, scope)
      ? external(name)
      : unresolved(name);
  }
  const root = rootIdentifier(object);
  return root !== null && KNOWN_GLOBALS.has(root) && !shadowed(root, scope)
    ? external(name)
    : unresolved(name);
};

const resolveNew = (callee: Node, scope: Scope): Resolved => {
  if (!isIdentifier(callee)) {
    return unresolved(calleeText(callee));
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
  callee: Node,
  scope: Scope
): Resolved => {
  if (kind === "new") {
    return resolveNew(callee, scope);
  }
  if (isIdentifier(callee)) {
    return resolveIdentifier(callee.name, scope);
  }
  return resolveMember(callee, scope);
};

type CallCollector = {
  readonly discovered: Discovered;
  readonly sites: CallSite[];
};

const callOf = (node: Node): { kind: CallKind; callee: Node } | null => {
  if (isCallExpression(node)) {
    return { kind: "call", callee: node.callee };
  }
  if (isOptionalCallExpression(node)) {
    return { kind: "optional-call", callee: node.callee };
  }
  return isNewExpression(node) ? { kind: "new", callee: node.callee } : null;
};

/**
 * Visits one function's subtree, stopping at nodes owned by other named
 * functions and switching scope at anonymous ones. `awaited` is true only
 * for the direct operand of an `await`.
 */
const visitCalls = (
  collector: CallCollector,
  callerId: string,
  outer: Scope,
  root: Node,
  node: Node,
  awaited: boolean,
  depth = 0
): void => {
  if (node !== root && collector.discovered.byNode.has(node)) {
    return;
  }
  guardDepth(depth);
  const scope = collector.discovered.scopeAt.get(node) ?? outer;
  if (isAwaitExpression(node)) {
    visitCalls(
      collector,
      callerId,
      scope,
      root,
      node.argument,
      true,
      depth + 1
    );
    return;
  }
  const call = callOf(node);
  if (call !== null) {
    const { calleeName, target, resolution } = resolveCallee(
      call.kind,
      call.callee,
      scope
    );
    const span = spanOf(node);
    collector.sites.push({
      id: callSiteId(callerId, span.start),
      callerId,
      calleeName,
      calleeId: target?.id ?? null,
      resolution,
      kind: call.kind,
      awaited,
      span,
    });
  }
  for (const child of childrenOf(node)) {
    visitCalls(collector, callerId, scope, root, child, false, depth + 1);
  }
};

type CallPass = {
  readonly callSites: readonly CallSite[];
  readonly edges: readonly CallEdge[];
};

const collectCalls = (
  moduleId: string,
  program: Node,
  discovered: Discovered
): CallPass => {
  const collector: CallCollector = { discovered, sites: [] };
  visitCalls(
    collector,
    moduleId,
    discovered.moduleScope,
    program,
    program,
    false
  );
  for (const fn of discovered.functions) {
    const node = discovered.nodeOf.get(fn);
    const scope = discovered.scopeOf.get(fn);
    if (node !== undefined && scope !== undefined) {
      visitCalls(collector, fn.id, scope, node, node, false);
    }
  }
  const callSites = [...collector.sites].sort(
    (a, b) => a.span.start - b.span.start
  );
  const edges = new Map<string, CallEdge>();
  for (const site of callSites) {
    if (site.calleeId === null || site.callerId === moduleId) {
      continue;
    }
    const key = `${site.callerId}->${site.calleeId}`;
    const existing = edges.get(key);
    edges.set(key, {
      type: "call",
      source: site.callerId,
      target: site.calleeId,
      callSiteIds: [...(existing?.callSiteIds ?? []), site.id],
    });
  }
  return { callSites, edges: [...edges.values()] };
};

export { collectCalls };
