// Lexical scopes and the small AST helpers the discovery pass is built on.

import {
  isArrayPattern,
  isArrowFunctionExpression,
  isAssignmentPattern,
  isClassMethod,
  isClassPrivateMethod,
  isClassPrivateProperty,
  isClassProperty,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isExportSpecifier,
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
  Program,
} from "@babel/types";
import type { FunctionKind, FunctionNode } from "@repo/code-graph";

type ClassTable = {
  readonly name: string;
  readonly instance: Map<string, FunctionNode>;
  readonly static: Map<string, FunctionNode>;
  ctor: FunctionNode | null;
};

/** One lexical scope: a function body, an anonymous function, or the module. */
type Scope = {
  /** The named function whose room owns calls made here (null: the module). */
  readonly fn: FunctionNode | null;
  /** The class `this` refers to here; null where `this` is dynamic or unknown. */
  readonly classTable: ClassTable | null;
  readonly isStatic: boolean;
  /** Named functions declared directly in this scope, resolvable by name. */
  readonly locals: Map<string, FunctionNode>;
  /** Classes declared directly in this scope, resolvable by name. */
  readonly classes: Map<string, ClassTable>;
  /** Every other binding (params, variables, imports): shadows outer names. */
  readonly bindings: Set<string>;
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
  fn: FunctionNode | null,
  classTable: ClassTable | null,
  isStatic: boolean
): Scope => ({
  fn,
  classTable,
  isStatic,
  locals: new Map(),
  classes: new Map(),
  bindings: new Set(),
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
  fn: FunctionNode | null,
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
      scope.bindings
    );
  }
  if (isFunctionExpression(node) && node.id !== null && node.id !== undefined) {
    if (fn === null) {
      scope.bindings.add(node.id.name);
    } else {
      scope.locals.set(node.id.name, fn);
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

/** `export { a, b as c }` (local names) and `export default a`. */
const exportedNamesOf = (program: Program): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (isExportNamedDeclaration(statement)) {
      for (const specifier of statement.specifiers) {
        if (
          isExportSpecifier(specifier) &&
          isIdentifier(specifier.local) &&
          (statement.source === null || statement.source === undefined)
        ) {
          names.add(specifier.local.name);
        }
      }
    } else if (
      isExportDefaultDeclaration(statement) &&
      isIdentifier(statement.declaration)
    ) {
      names.add(statement.declaration.name);
    }
  }
  return names;
};

export {
  bindingNames,
  exportedNamesOf,
  fieldFunction,
  functionScope,
  isFunctionLike,
  memberName,
  methodKind,
  newScope,
};
export type { ClassTable, FunctionLike, Scope };
