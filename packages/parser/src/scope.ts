// Lexical scopes and the small AST helpers the discovery pass is built on.

import {
  isArrayPattern,
  isArrowFunctionExpression,
  isAssignmentPattern,
  isClassMethod,
  isClassPrivateMethod,
  isClassPrivateProperty,
  isClassProperty,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isObjectMethod,
  isObjectPattern,
  isObjectProperty,
  isRestElement,
  isStringLiteral,
  isTSParameterProperty,
} from "@babel/types";
import type {
  ArrowFunctionExpression,
  ClassBody,
  ClassMethod,
  ClassPrivateMethod,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  ObjectMethod,
} from "@babel/types";
import type {
  FunctionKind,
  FunctionNode,
  ImportRecord,
} from "@repo/code-graph";

/**
 * A function as the discovery and call passes know it: everything but its
 * flow, which needs the call sites and is attached last by `parseModule`.
 */
type DiscoveredFunction = Omit<FunctionNode, "flow">;

type ClassTable = {
  readonly name: string;
  readonly instance: Map<string, DiscoveredFunction>;
  readonly static: Map<string, DiscoveredFunction>;
  ctor: DiscoveredFunction | null;
};

/** One lexical scope: a function body, an anonymous function, or the module. */
type Scope = {
  /** The named function whose room owns calls made here (null: the module). */
  readonly fn: DiscoveredFunction | null;
  /** The class `this` refers to here; null where `this` is dynamic or unknown. */
  readonly classTable: ClassTable | null;
  readonly isStatic: boolean;
  /**
   * Named functions declared directly in this scope, resolvable by name.
   * Block scopes are folded into their function, so one name may hold
   * several (one per branch that declares it), in source order.
   */
  readonly locals: Map<string, DiscoveredFunction[]>;
  /** Classes declared directly in this scope, resolvable by name. */
  readonly classes: Map<string, ClassTable>;
  /** Every other binding (params, variables, imports): shadows outer names. */
  readonly bindings: Set<string>;
  /** The bindings that are parameters: a call to one is dynamic. */
  readonly params: Set<string>;
  /** Module scope only: the bindings that are imports, by local name. */
  readonly imports: Map<string, ImportRecord>;
  readonly parent: Scope | null;
};

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression
  | ObjectMethod
  | ClassMethod
  | ClassPrivateMethod;

/** Identifier-shaped names only: anything else cannot be called by name. */
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

const newScope = (
  parent: Scope | null,
  fn: DiscoveredFunction | null,
  classTable: ClassTable | null,
  isStatic: boolean
): Scope => ({
  fn,
  classTable,
  isStatic,
  locals: new Map(),
  classes: new Map(),
  bindings: new Set(),
  params: new Set(),
  imports: new Map(),
  parent,
});

/** Every identifier a binding pattern introduces. */
const bindingNames = (pattern: Node, into: Set<string>): void => {
  if (isIdentifier(pattern)) {
    into.add(pattern.name);
  } else if (isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      bindingNames(
        isObjectProperty(property) ? property.value : property,
        into
      );
    }
  } else if (isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element !== null) {
        bindingNames(element, into);
      }
    }
  } else if (isRestElement(pattern)) {
    bindingNames(pattern.argument, into);
  } else if (isAssignmentPattern(pattern)) {
    bindingNames(pattern.left, into);
  }
};

const isFunctionLike = (node: Node): node is FunctionLike =>
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isArrowFunctionExpression(node) ||
  isObjectMethod(node) ||
  isClassMethod(node) ||
  isClassPrivateMethod(node);

/**
 * The scope inside a function: its parameters, and for a function
 * expression its own name (which refers to itself). Arrows keep the `this`
 * of their surroundings; every other function has a dynamic `this`, unless
 * it is a class member, which `table` says. An anonymous function (`fn`
 * null) stays owned by the nearest named one, so anything declared inside
 * it still nests under that room.
 */
const functionScope = (
  parent: Scope,
  node: FunctionLike,
  fn: DiscoveredFunction | null,
  table: ClassTable | null,
  isStatic: boolean
): Scope => {
  const arrow = isArrowFunctionExpression(node);
  const scope = newScope(
    parent,
    fn ?? parent.fn,
    table ?? (arrow ? parent.classTable : null),
    table === null ? arrow && parent.isStatic : isStatic
  );
  for (const param of node.params) {
    bindingNames(
      isTSParameterProperty(param) ? param.parameter : param,
      scope.params
    );
  }
  for (const name of scope.params) {
    scope.bindings.add(name);
  }
  if (isFunctionExpression(node) && node.id !== null && node.id !== undefined) {
    if (fn === null) {
      scope.bindings.add(node.id.name);
    } else {
      scope.locals.set(node.id.name, [fn]);
    }
  }
  return scope;
};

const memberName = (
  member: ClassMethod | ClassPrivateMethod
): string | null => {
  if (isClassPrivateMethod(member)) {
    return `#${member.key.id.name}`;
  }
  if (member.computed) {
    return null;
  }
  if (isIdentifier(member.key)) {
    return member.key.name;
  }
  return isStringLiteral(member.key) && IDENTIFIER.test(member.key.value)
    ? member.key.value
    : null;
};

const methodKind = (member: ClassMethod | ClassPrivateMethod): FunctionKind => {
  if (member.kind === "constructor") {
    return "constructor";
  }
  if (member.kind === "get") {
    return "getter";
  }
  return member.kind === "set" ? "setter" : "method";
};

type FieldFunction = {
  readonly name: string;
  readonly value: FunctionLike;
  readonly isStatic: boolean;
};

/** A class field holding a function: `handle = () => {}`, `#hidden = () => {}`. */
const fieldFunction = (
  member: ClassBody["body"][number]
): FieldFunction | null => {
  if (
    isClassProperty(member) &&
    !member.computed &&
    isIdentifier(member.key) &&
    (isArrowFunctionExpression(member.value) ||
      isFunctionExpression(member.value))
  ) {
    return {
      name: member.key.name,
      value: member.value,
      isStatic: member.static,
    };
  }
  if (
    isClassPrivateProperty(member) &&
    (isArrowFunctionExpression(member.value) ||
      isFunctionExpression(member.value))
  ) {
    return {
      name: `#${member.key.id.name}`,
      value: member.value,
      isStatic: member.static,
    };
  }
  return null;
};

export {
  bindingNames,
  fieldFunction,
  functionScope,
  isFunctionLike,
  memberName,
  methodKind,
  newScope,
};
export type { ClassTable, DiscoveredFunction, FunctionLike, Scope };
