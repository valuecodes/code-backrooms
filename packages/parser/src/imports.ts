// What a module imports and exports, as plain records the linker can follow
// (PR B of Phase 4 resolves `ImportRecord.moduleId`). Type-only imports and
// exports are skipped: they never reach a call. So are `import x =
// require()` and `export =`, which are TypeScript's CommonJS forms. A
// side-effect import is still a dependency: one record without names.

import {
  isArrowFunctionExpression,
  isClassDeclaration,
  isExportAllDeclaration,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isExportNamespaceSpecifier,
  isExportSpecifier,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isVariableDeclaration,
} from "@babel/types";
import type {
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Identifier,
  Program,
  StringLiteral,
} from "@babel/types";
import type { ExportRecord, ImportRecord } from "@repo/code-graph";

import { bindingNames } from "./scope";
import { spanOf } from "./span";

/** `a` and `"a-b"` alike: module export names may be string literals. */
const nameOf = (node: Identifier | StringLiteral): string =>
  isIdentifier(node) ? node.name : node.value;

const importsOf = (program: Program): readonly ImportRecord[] =>
  program.body.flatMap((statement) => {
    if (!isImportDeclaration(statement) || statement.importKind === "type") {
      return [];
    }
    const specifier = statement.source.value;
    if (statement.specifiers.length === 0) {
      return [
        {
          localName: null,
          importedName: null,
          specifier,
          moduleId: null,
          span: spanOf(statement),
        },
      ];
    }
    return statement.specifiers.flatMap((item): ImportRecord[] => {
      if (isImportDefaultSpecifier(item) || isImportNamespaceSpecifier(item)) {
        const importedName = isImportDefaultSpecifier(item) ? "default" : "*";
        return [
          {
            localName: item.local.name,
            importedName,
            specifier,
            moduleId: null,
            span: spanOf(item),
          },
        ];
      }
      return item.importKind === "type"
        ? []
        : [
            {
              localName: item.local.name,
              importedName: nameOf(item.imported),
              specifier,
              moduleId: null,
              span: spanOf(item),
            },
          ];
    });
  });

const local = (
  exportedName: string,
  localName: string | null
): ExportRecord => ({
  exportedName,
  localName,
  specifier: null,
  importedName: null,
});

/** `export function f`, `export class C`, `export const a = 1, { b } = c`. */
const declarationExports = (
  declaration: NonNullable<ExportNamedDeclaration["declaration"]>
): readonly ExportRecord[] => {
  if (isFunctionDeclaration(declaration) || isClassDeclaration(declaration)) {
    return declaration.id === null || declaration.id === undefined
      ? []
      : [local(declaration.id.name, declaration.id.name)];
  }
  if (isVariableDeclaration(declaration)) {
    const names = new Set<string>();
    for (const declarator of declaration.declarations) {
      bindingNames(declarator.id, names);
    }
    return [...names].map((name) => local(name, name));
  }
  // Interfaces, type aliases, enums, namespaces and `declare`d functions.
  return [];
};

const namedExports = (
  statement: ExportNamedDeclaration
): readonly ExportRecord[] => {
  if (statement.exportKind === "type") {
    return [];
  }
  if (statement.declaration !== null && statement.declaration !== undefined) {
    return declarationExports(statement.declaration);
  }
  const specifier = statement.source?.value ?? null;
  return statement.specifiers.flatMap((item): ExportRecord[] => {
    if (isExportNamespaceSpecifier(item)) {
      return [
        {
          exportedName: nameOf(item.exported),
          localName: null,
          specifier,
          importedName: "*",
        },
      ];
    }
    if (!isExportSpecifier(item) || item.exportKind === "type") {
      return [];
    }
    const exportedName = nameOf(item.exported);
    const name = nameOf(item.local);
    return [
      specifier === null
        ? local(exportedName, name)
        : { exportedName, localName: null, specifier, importedName: name },
    ];
  });
};

/**
 * `export default` names its target: a named function or class by its name,
 * an anonymous one (and an arrow or function expression) by `"default"`, the
 * name the parser gives its function node; an identifier by itself; any
 * other expression has no local binding.
 */
const defaultExport = (statement: ExportDefaultDeclaration): ExportRecord => {
  const { declaration } = statement;
  if (isFunctionDeclaration(declaration) || isClassDeclaration(declaration)) {
    return local("default", declaration.id?.name ?? "default");
  }
  if (
    isArrowFunctionExpression(declaration) ||
    isFunctionExpression(declaration)
  ) {
    return local("default", "default");
  }
  return local("default", isIdentifier(declaration) ? declaration.name : null);
};

const exportsOf = (program: Program): readonly ExportRecord[] =>
  program.body.flatMap((statement): readonly ExportRecord[] => {
    if (isExportNamedDeclaration(statement)) {
      return namedExports(statement);
    }
    if (isExportDefaultDeclaration(statement)) {
      return [defaultExport(statement)];
    }
    if (isExportAllDeclaration(statement) && statement.exportKind !== "type") {
      return [
        {
          exportedName: "*",
          localName: null,
          specifier: statement.source.value,
          importedName: "*",
        },
      ];
    }
    return [];
  });

/** Local bindings a module exports under any name (re-exports excluded). */
const exportedLocalNames = (
  exports: readonly ExportRecord[]
): ReadonlySet<string> =>
  new Set(
    exports.flatMap((record) =>
      record.specifier === null && record.localName !== null
        ? [record.localName]
        : []
    )
  );

export { exportedLocalNames, exportsOf, importsOf };
