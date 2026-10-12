// The module's own bindings, read from the program body: what an import of
// this module can reach. Discovery folds block scopes into the module, so a
// block's `function f` and the module's `f` share a name (`f`, `f~2`); the
// linker asks here which one is the module's.

import {
  isClassDeclaration,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isVariableDeclaration,
} from "@babel/types";
import type { Node, Program } from "@babel/types";

import type { DiscoveredFunction } from "./scope";

/** The offsets a class's members lie in, and the identifier it extends. */
type ClassRange = {
  readonly start: number;
  readonly end: number;
  readonly superName: string | null;
};

type TopLevel = {
  /** Plain functions by binding name: declarations, `const f = () => …`, an anonymous default. */
  readonly functions: ReadonlyMap<string, DiscoveredFunction>;
  /** Class declarations by name. */
  readonly classes: ReadonlyMap<string, ClassRange>;
};

const topLevelOf = (
  program: Program,
  byNode: ReadonlyMap<Node, DiscoveredFunction>
): TopLevel => {
  const functions = new Map<string, DiscoveredFunction>();
  const classes = new Map<string, ClassRange>();
  const add = (name: string, node: Node | null | undefined) => {
    const fn =
      node === null || node === undefined ? undefined : byNode.get(node);
    if (fn !== undefined) {
      functions.set(name, fn);
    }
  };
  for (const statement of program.body) {
    const declaration =
      isExportNamedDeclaration(statement) ||
      isExportDefaultDeclaration(statement)
        ? statement.declaration
        : statement;
    const fallback = isExportDefaultDeclaration(statement) ? "default" : null;
    if (isClassDeclaration(declaration)) {
      const name = declaration.id?.name ?? fallback;
      if (name !== null) {
        classes.set(name, {
          start: declaration.start ?? 0,
          end: declaration.end ?? 0,
          superName: isIdentifier(declaration.superClass)
            ? declaration.superClass.name
            : null,
        });
      }
    } else if (isVariableDeclaration(declaration)) {
      for (const { id, init } of declaration.declarations) {
        if (isIdentifier(id)) {
          add(id.name, init);
        }
      }
    } else if (isFunctionDeclaration(declaration)) {
      const name = declaration.id?.name ?? fallback;
      if (name !== null) {
        add(name, declaration);
      }
    } else if (fallback !== null) {
      // `export default () => {}`: the parser names that function `default`.
      add(fallback, declaration);
    }
  }
  return { functions, classes };
};

export { topLevelOf };
export type { TopLevel };
