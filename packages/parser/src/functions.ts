// Discovery pass: which named functions a module declares, where, and what
// names each lexical scope binds. Class members go into a per-class table so
// a bare `load()` never resolves to a method; anonymous functions get a scope
// of their own (their calls are still attributed to the enclosing room).

import {
  isArrowFunctionExpression,
  isCatchClause,
  isClassDeclaration,
  isClassMethod,
  isClassPrivateMethod,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isVariableDeclaration,
} from "@babel/types";
import type { ClassBody, Node, Program } from "@babel/types";
import type { ContainmentEdge, FunctionKind } from "@repo/code-graph";
import { functionId, uniqueNames } from "@repo/code-graph/ids";

import {
  bindingNames,
  exportedNamesOf,
  fieldFunction,
  functionScope,
  isFunctionLike,
  memberName,
  methodKind,
  newScope,
} from "./scope";
import type {
  ClassTable,
  DiscoveredFunction,
  FunctionLike,
  Scope,
} from "./scope";
import { spanOf } from "./span";
import { childrenOf, guardDepth } from "./walk";

type Discovered = {
  readonly functions: DiscoveredFunction[];
  readonly edges: ContainmentEdge[];
  /** The AST node each function was built from, for the call and flow passes. */
  readonly nodeOf: Map<DiscoveredFunction, FunctionLike>;
  readonly byNode: Map<Node, DiscoveredFunction>;
  /** The scope inside each named function. */
  readonly scopeOf: Map<DiscoveredFunction, Scope>;
  /** The scope inside each anonymous function, keyed by its node. */
  readonly scopeAt: Map<Node, Scope>;
  readonly moduleScope: Scope;
};

type Context = {
  readonly moduleId: string;
  readonly nextName: (qualifiedName: string) => string;
  /** Names exported by `export { a, b }` or `export default a`. */
  readonly exportedNames: ReadonlySet<string>;
  readonly out: Discovered;
};

type Registration = {
  readonly node: FunctionLike;
  readonly name: string;
  readonly kind: FunctionKind;
  readonly exported: boolean;
  readonly table: ClassTable | null;
  readonly isStatic: boolean;
};

/** Builds the FunctionNode, records it, then walks its body in a new scope. */
const register = (
  context: Context,
  scope: Scope,
  registration: Registration,
  depth = 0
): DiscoveredFunction => {
  const { node, name, kind, exported, table, isStatic } = registration;
  const className = table?.name ?? null;
  const qualifiedName = context.nextName(
    [scope.fn?.qualifiedName, className, name]
      .filter((part) => part !== null && part !== undefined)
      .join(".")
  );
  const fn: DiscoveredFunction = {
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
  if (table === null) {
    scope.locals.set(name, fn);
  }
  const inner = functionScope(scope, node, fn, table, isStatic);
  context.out.scopeOf.set(fn, inner);
  for (const child of childrenOf(node)) {
    visit(context, inner, child, false, depth + 1);
  }
  return fn;
};

const visitClassBody = (
  context: Context,
  scope: Scope,
  name: string,
  body: ClassBody,
  exported: boolean,
  depth: number
): void => {
  const table: ClassTable = {
    name,
    instance: new Map(),
    static: new Map(),
    ctor: null,
  };
  scope.classes.set(name, table);
  for (const member of body.body) {
    const field = fieldFunction(member);
    if (isClassMethod(member) || isClassPrivateMethod(member)) {
      const method = memberName(member);
      if (method === null) {
        continue;
      }
      const fn = register(
        context,
        scope,
        {
          node: member,
          name: method,
          kind: methodKind(member),
          exported,
          table,
          isStatic: member.static,
        },
        depth
      );
      if (fn.kind === "constructor") {
        table.ctor = fn;
      } else {
        (member.static ? table.static : table.instance).set(method, fn);
      }
    } else if (field !== null) {
      const fn = register(
        context,
        scope,
        {
          node: field.value,
          name: field.name,
          kind: isArrowFunctionExpression(field.value) ? "arrow" : "expression",
          exported,
          table,
          isStatic: field.isStatic,
        },
        depth
      );
      (field.isStatic ? table.static : table.instance).set(field.name, fn);
    } else {
      for (const child of childrenOf(member)) {
        visit(context, scope, child, false, depth + 1);
      }
    }
  }
};

/** Whether a module-level name is exported, by declaration or by list. */
const isExported = (
  context: Context,
  scope: Scope,
  name: string,
  exported: boolean
): boolean =>
  exported || (scope.parent === null && context.exportedNames.has(name));

const visit = (
  context: Context,
  scope: Scope,
  node: Node,
  exported: boolean,
  depth = 0
): void => {
  guardDepth(depth);
  const next = (child: Node, inner: Scope, flag = false) =>
    visit(context, inner, child, flag, depth + 1);
  if (isExportNamedDeclaration(node)) {
    if (node.declaration !== null && node.declaration !== undefined) {
      next(node.declaration, scope, true);
    }
    return;
  }
  if (isExportDefaultDeclaration(node)) {
    const { declaration } = node;
    if (isFunctionDeclaration(declaration) || isClassDeclaration(declaration)) {
      next(declaration, scope, true);
    } else if (
      isArrowFunctionExpression(declaration) ||
      isFunctionExpression(declaration)
    ) {
      register(context, scope, {
        node: declaration,
        name: "default",
        kind: isArrowFunctionExpression(declaration) ? "arrow" : "expression",
        exported: true,
        table: null,
        isStatic: false,
      });
    } else {
      next(declaration, scope);
    }
    return;
  }
  if (isFunctionDeclaration(node)) {
    // Only `export default function () {}` has no id.
    const name = node.id?.name ?? "default";
    register(context, scope, {
      node,
      name,
      kind: "declaration",
      exported: isExported(context, scope, name, exported),
      table: null,
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
          exported: isExported(context, scope, id.name, exported),
          table: null,
          isStatic: false,
        });
        continue;
      }
      bindingNames(id, scope.bindings);
      if (init !== null && init !== undefined) {
        next(init, scope);
      }
    }
    return;
  }
  if (isClassDeclaration(node)) {
    // Only `export default class {}` has no id.
    const name = node.id?.name ?? "default";
    scope.bindings.add(name);
    visitClassBody(
      context,
      scope,
      name,
      node.body,
      isExported(context, scope, name, exported),
      depth + 1
    );
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
  // Anonymous functions, callbacks, IIFEs, object methods and the members of
  // class expressions are not rooms: their calls belong to the enclosing
  // function, but their parameters are their own.
  if (isFunctionLike(node)) {
    const inner = functionScope(scope, node, null, null, false);
    context.out.scopeAt.set(node, inner);
    for (const child of childrenOf(node)) {
      next(child, inner);
    }
    return;
  }
  for (const child of childrenOf(node)) {
    next(child, scope);
  }
};

const discover = (moduleId: string, program: Program): Discovered => {
  const moduleScope = newScope(null, null, null, false);
  const out: Discovered = {
    functions: [],
    edges: [],
    nodeOf: new Map(),
    byNode: new Map(),
    scopeOf: new Map(),
    scopeAt: new Map(),
    moduleScope,
  };
  const context: Context = {
    moduleId,
    nextName: uniqueNames(),
    exportedNames: exportedNamesOf(program),
    out,
  };
  for (const statement of program.body) {
    visit(context, moduleScope, statement, false);
  }
  return out;
};

export { discover };
export type { Discovered };
