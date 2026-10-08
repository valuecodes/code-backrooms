// Discovery pass: which named functions a module declares, where, and what
// names are bound in each scope. Class members go into a per-class table so a
// bare `load()` never resolves to a method.

import {
  isArrayPattern,
  isArrowFunctionExpression,
  isAssignmentPattern,
  isCatchClause,
  isClassDeclaration,
  isClassMethod,
  isClassPrivateMethod,
  isClassProperty,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isObjectPattern,
  isObjectProperty,
  isRestElement,
  isStringLiteral,
  isTSParameterProperty,
  isVariableDeclaration,
} from "@babel/types";
import type {
  ArrowFunctionExpression,
  ClassBody,
  ClassMethod,
  ClassPrivateMethod,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  Program,
} from "@babel/types";
import type {
  ContainmentEdge,
  FunctionKind,
  FunctionNode,
} from "@repo/code-graph";
import { functionId, uniqueNames } from "@repo/code-graph/ids";

import { spanOf } from "./span";
import { childrenOf } from "./walk";

/** A function body (or the module): the names it declares and what it is. */
type Scope = {
  readonly fn: FunctionNode | null;
  readonly className: string | null;
  readonly isStatic: boolean;
  /** Named functions declared directly in this scope, resolvable by name. */
  readonly locals: Map<string, FunctionNode>;
  /** Every other binding (params, variables, imports, classes): shadows outer names. */
  readonly bindings: Set<string>;
  readonly parent: Scope | null;
};

type ClassTable = {
  readonly instance: Map<string, FunctionNode>;
  readonly static: Map<string, FunctionNode>;
  ctor: FunctionNode | null;
};

type Discovered = {
  readonly functions: FunctionNode[];
  readonly edges: ContainmentEdge[];
  /** The AST node each function was built from, for the call pass. */
  readonly nodeOf: Map<FunctionNode, Node>;
  readonly byNode: Map<Node, FunctionNode>;
  /** The scope inside each function. */
  readonly scopeOf: Map<FunctionNode, Scope>;
  readonly moduleScope: Scope;
  readonly classes: Map<string, ClassTable>;
};

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression
  | ClassMethod
  | ClassPrivateMethod;

type Context = {
  readonly moduleId: string;
  readonly nextName: (qualifiedName: string) => string;
  readonly out: Discovered;
};

const childScope = (
  parent: Scope,
  fn: FunctionNode,
  className: string | null,
  isStatic: boolean
): Scope => ({
  fn,
  className,
  isStatic,
  locals: new Map(),
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

const paramNames = (node: FunctionLike, into: Set<string>): void => {
  for (const param of node.params) {
    bindingNames(isTSParameterProperty(param) ? param.parameter : param, into);
  }
};

type Registration = {
  readonly node: FunctionLike;
  readonly name: string;
  readonly kind: FunctionKind;
  readonly exported: boolean;
  readonly className: string | null;
  readonly isStatic: boolean;
};

/** Builds the FunctionNode, records it, then walks its body in a new scope. */
const register = (
  context: Context,
  scope: Scope,
  registration: Registration
): FunctionNode => {
  const { node, name, kind, exported, className, isStatic } = registration;
  const owner = scope.fn?.qualifiedName ?? className;
  const qualifiedName = context.nextName(
    owner === null ? name : `${owner}.${name}`
  );
  const fn: FunctionNode = {
    id: functionId(context.moduleId, qualifiedName),
    moduleId: context.moduleId,
    name,
    qualifiedName,
    kind,
    span: spanOf(node),
    exported,
    async: node.async,
    isStatic,
    parentId: scope.fn?.id ?? null,
    className,
  };
  context.out.functions.push(fn);
  context.out.edges.push({
    type: "containment",
    source: scope.fn?.id ?? context.moduleId,
    target: fn.id,
  });
  context.out.nodeOf.set(fn, node);
  context.out.byNode.set(node, fn);
  if (className === null) {
    scope.locals.set(name, fn);
  }
  // A nested function keeps its class context; a member sets it.
  const inner = childScope(
    scope,
    fn,
    className ?? scope.className,
    className === null ? scope.isStatic : isStatic
  );
  paramNames(node, inner.bindings);
  context.out.scopeOf.set(fn, inner);
  for (const child of childrenOf(node)) {
    visit(context, inner, child, false);
  }
  return fn;
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
  return isStringLiteral(member.key) ? member.key.value : null;
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

const visitClassBody = (
  context: Context,
  scope: Scope,
  className: string,
  body: ClassBody,
  exported: boolean
): void => {
  const table: ClassTable = {
    instance: new Map(),
    static: new Map(),
    ctor: null,
  };
  context.out.classes.set(className, table);
  for (const member of body.body) {
    if (isClassMethod(member) || isClassPrivateMethod(member)) {
      const name = memberName(member);
      if (name === null) {
        continue;
      }
      const fn = register(context, scope, {
        node: member,
        name,
        kind: methodKind(member),
        exported,
        className,
        isStatic: member.static,
      });
      if (fn.kind === "constructor") {
        table.ctor = fn;
      } else {
        (member.static ? table.static : table.instance).set(name, fn);
      }
    } else if (
      isClassProperty(member) &&
      !member.computed &&
      isIdentifier(member.key) &&
      (isArrowFunctionExpression(member.value) ||
        isFunctionExpression(member.value))
    ) {
      const fn = register(context, scope, {
        node: member.value,
        name: member.key.name,
        kind: isArrowFunctionExpression(member.value) ? "arrow" : "expression",
        exported,
        className,
        isStatic: member.static,
      });
      (member.static ? table.static : table.instance).set(member.key.name, fn);
    } else {
      for (const child of childrenOf(member)) {
        visit(context, scope, child, false);
      }
    }
  }
};

const visit = (
  context: Context,
  scope: Scope,
  node: Node,
  exported: boolean
): void => {
  if (isExportNamedDeclaration(node)) {
    if (node.declaration !== null && node.declaration !== undefined) {
      visit(context, scope, node.declaration, true);
    }
    return;
  }
  if (isExportDefaultDeclaration(node)) {
    const { declaration } = node;
    if (isFunctionDeclaration(declaration) || isClassDeclaration(declaration)) {
      visit(context, scope, declaration, true);
    } else if (
      isArrowFunctionExpression(declaration) ||
      isFunctionExpression(declaration)
    ) {
      register(context, scope, {
        node: declaration,
        name: "default",
        kind: isArrowFunctionExpression(declaration) ? "arrow" : "expression",
        exported: true,
        className: null,
        isStatic: false,
      });
    } else {
      visit(context, scope, declaration, false);
    }
    return;
  }
  if (isFunctionDeclaration(node)) {
    // Only `export default function () {}` has no id.
    register(context, scope, {
      node,
      name: node.id?.name ?? "default",
      kind: "declaration",
      exported,
      className: null,
      isStatic: false,
    });
    return;
  }
  if (isVariableDeclaration(node)) {
    for (const declarator of node.declarations) {
      const { id, init } = declarator;
      if (
        isIdentifier(id) &&
        (isArrowFunctionExpression(init) || isFunctionExpression(init))
      ) {
        register(context, scope, {
          node: init,
          name: id.name,
          kind: isArrowFunctionExpression(init) ? "arrow" : "expression",
          exported,
          className: null,
          isStatic: false,
        });
        continue;
      }
      bindingNames(id, scope.bindings);
      if (init !== null && init !== undefined) {
        visit(context, scope, init, false);
      }
    }
    return;
  }
  if (isClassDeclaration(node)) {
    if (node.id === null || node.id === undefined) {
      visitClassBody(context, scope, "default", node.body, exported);
      return;
    }
    scope.bindings.add(node.id.name);
    visitClassBody(context, scope, node.id.name, node.body, exported);
    return;
  }
  if (isImportDeclaration(node)) {
    for (const specifier of node.specifiers) {
      scope.bindings.add(specifier.local.name);
    }
    return;
  }
  if (isCatchClause(node) && node.param !== null && node.param !== undefined) {
    bindingNames(node.param, scope.bindings);
  }
  // Anonymous functions, callbacks, IIFEs, object methods and class
  // expressions are not rooms: their calls belong to the enclosing function.
  if (
    isArrowFunctionExpression(node) ||
    isFunctionExpression(node) ||
    isClassMethod(node) ||
    isClassPrivateMethod(node)
  ) {
    paramNames(node, scope.bindings);
  }
  for (const child of childrenOf(node)) {
    visit(context, scope, child, false);
  }
};

const discover = (moduleId: string, program: Program): Discovered => {
  const moduleScope: Scope = {
    fn: null,
    className: null,
    isStatic: false,
    locals: new Map(),
    bindings: new Set(),
    parent: null,
  };
  const out: Discovered = {
    functions: [],
    edges: [],
    nodeOf: new Map(),
    byNode: new Map(),
    scopeOf: new Map(),
    moduleScope,
    classes: new Map(),
  };
  const context: Context = { moduleId, nextName: uniqueNames(), out };
  for (const statement of program.body) {
    visit(context, moduleScope, statement, false);
  }
  return out;
};

export { discover };
export type { Discovered, Scope };
