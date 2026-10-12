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
  isNewExpression,
  isObjectMethod,
  isObjectPattern,
  isObjectProperty,
  isParenthesizedExpression,
  isRestElement,
  isStringLiteral,
  isTSAsExpression,
  isTSInstantiationExpression,
  isTSNonNullExpression,
  isTSNullKeyword,
  isTSParameterProperty,
  isTSParenthesizedType,
  isTSSatisfiesExpression,
  isTSTypeAnnotation,
  isTSTypeAssertion,
  isTSTypeReference,
  isTSUndefinedKeyword,
  isTSUnionType,
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
  TSType,
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

/**
 * The class a binding holds, by the name its declaration gives it
 * (`x: Svc`, `new Svc()`), resolved later from the scope that binds it.
 * `exact` when it is known to hold that very class (`const x = new Svc()`,
 * never written), so no subclass can stand in for it.
 */
type ReceiverType = { readonly name: string; readonly exact: boolean };

/**
 * Binding names to their class; null where one folded scope binds the name
 * more than once with different or missing types, so it never resolves.
 */
type ReceiverTypes = Map<string, ReceiverType | null>;

type ClassTable = {
  readonly name: string;
  readonly instance: Map<string, DiscoveredFunction>;
  readonly static: Map<string, DiscoveredFunction>;
  ctor: DiscoveredFunction | null;
  /** Instance fields, typed or not: an untyped one still hides a base's. */
  readonly fields: ReceiverTypes;
  /** The `extends` identifier, resolved from `scope`. */
  readonly superName: string | null;
  /** The scope the class is declared in. */
  readonly scope: Scope;
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
  /** Module scope only: type-only imports (`import type { Svc }`). */
  readonly typeImports: Map<string, ImportRecord>;
  /** The classes of this scope's bindings, where their declarations say. */
  readonly types: ReceiverTypes;
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
  typeImports: new Map(),
  types: new Map(),
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

/** `Svc` from `Svc`, `Svc<T>` or `Svc | null | undefined`; else null. */
const referenceName = (type: TSType): string | null => {
  if (isTSParenthesizedType(type)) {
    return referenceName(type.typeAnnotation);
  }
  if (isTSTypeReference(type)) {
    return isIdentifier(type.typeName) ? type.typeName.name : null;
  }
  if (isTSUnionType(type)) {
    const [only, ...rest] = type.types.filter(
      (member) => !isTSNullKeyword(member) && !isTSUndefinedKeyword(member)
    );
    return only === undefined || rest.length > 0 ? null : referenceName(only);
  }
  return null;
};

/** The class name a `: Svc` annotation gives, if it gives one. */
const typeNameOf = (annotation: Node | null | undefined): string | null =>
  isTSTypeAnnotation(annotation)
    ? referenceName(annotation.typeAnnotation)
    : null;

/** `Svc` from `new Svc(…)` (through `as`, `!` and parentheses). */
const newClassNameOf = (init: Node | null | undefined): string | null => {
  if (init === null || init === undefined) {
    return null;
  }
  const node = unwrap(init);
  return isNewExpression(node) && isIdentifier(node.callee)
    ? node.callee.name
    : null;
};

/**
 * A binding's class: its annotation, a contract TypeScript checks, else the
 * `new` it starts with, unless the module writes the name anywhere (so it
 * may come to hold anything). `exact` only for a `new` nothing replaces:
 * never written and not `replaceable` (a parameter's caller, a field's
 * owner may put another instance there).
 */
const receiverOf = (
  annotation: Node | null | undefined,
  init: Node | null | undefined,
  written: boolean,
  replaceable: boolean
): ReceiverType | null => {
  const annotated = typeNameOf(annotation);
  const created = newClassNameOf(init);
  const exact = created !== null && !written && !replaceable;
  if (annotated !== null) {
    return { name: annotated, exact: exact && created === annotated };
  }
  return created === null || written ? null : { name: created, exact };
};

/**
 * Records the class of a binding declared in `types`' scope. A name bound
 * again in the same (folded) scope keeps a class only while every
 * declaration agrees on it.
 */
const declareType = (
  types: ReceiverTypes,
  bound: boolean,
  name: string,
  type: ReceiverType | null
): void => {
  if (!bound) {
    if (type !== null) {
      types.set(name, type);
    }
    return;
  }
  const before = types.get(name);
  types.set(
    name,
    before !== undefined &&
      before !== null &&
      type !== null &&
      before.name === type.name
      ? { name: type.name, exact: before.exact && type.exact }
      : null
  );
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
  isStatic: boolean,
  written: ReadonlySet<string>
): Scope => {
  const arrow = isArrowFunctionExpression(node);
  const scope = newScope(
    parent,
    fn ?? parent.fn,
    table ?? (arrow ? parent.classTable : null),
    table === null ? arrow && parent.isStatic : isStatic
  );
  for (const param of node.params) {
    const binding = isTSParameterProperty(param) ? param.parameter : param;
    bindingNames(binding, scope.params);
    const [id, init] = isAssignmentPattern(binding)
      ? [binding.left, binding.right]
      : [binding, null];
    if (isIdentifier(id)) {
      declareType(
        scope.types,
        false,
        id.name,
        receiverOf(id.typeAnnotation, init, written.has(id.name), true)
      );
    }
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
  declareType,
  fieldFunction,
  functionScope,
  isFunctionLike,
  memberName,
  methodKind,
  newScope,
  receiverOf,
  unwrap,
};
export type {
  ClassTable,
  DiscoveredFunction,
  FunctionLike,
  ReceiverType,
  Scope,
};
