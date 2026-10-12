// What a module imports and exports, as plain records the linker can follow
// (PR B of Phase 4 resolves `ImportRecord.moduleId`). Type-only imports and
// exports never reach a call, so the module's records skip them; asked for
// by `kind`, they are read on their own, for the classes a receiver is
// annotated with (`runner: AgentRunner`). `import x = require()` and
// `export =`, TypeScript's CommonJS forms, are skipped. A side-effect
// import is still a dependency: one record without names.

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
  isImportSpecifier,
  isTSDeclareFunction,
  isTSEnumDeclaration,
  isTSInterfaceDeclaration,
  isTSModuleDeclaration,
  isTSQualifiedName,
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

/** Value records, or only the type-only ones (`import type`, `{ type X }`). */
type RecordKind = "value" | "type";

const importsOf = (
  program: Program,
  kind: RecordKind = "value"
): readonly ImportRecord[] =>
  program.body.flatMap((statement) => {
    if (!isImportDeclaration(statement)) {
      return [];
    }
    const specifier = statement.source.value;
    const typeOnly = statement.importKind === "type";
    if (statement.specifiers.length === 0) {
      return typeOnly || kind === "type"
        ? []
        : [
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
      const itemTypeOnly =
        typeOnly || (isImportSpecifier(item) && item.importKind === "type");
      if (itemTypeOnly !== (kind === "type")) {
        return [];
      }
      let importedName = "*";
      if (isImportDefaultSpecifier(item)) {
        importedName = "default";
      } else if (isImportSpecifier(item)) {
        importedName = nameOf(item.imported);
      }
      return [
        {
          localName: item.local.name,
          importedName,
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
  // Runtime enums and namespaces (`namespace A.B` binds `A`); `declare`d and
  // `const` enums, ambient modules, interfaces and type aliases emit nothing.
  if (
    isTSEnumDeclaration(declaration) &&
    declaration.declare !== true &&
    declaration.const !== true
  ) {
    return [local(declaration.id.name, declaration.id.name)];
  }
  if (isTSModuleDeclaration(declaration) && declaration.declare !== true) {
    let id = declaration.id;
    while (isTSQualifiedName(id)) {
      id = id.left;
    }
    return isIdentifier(id) ? [local(id.name, id.name)] : [];
  }
  return [];
};

const namedExports = (
  statement: ExportNamedDeclaration,
  kind: RecordKind
): readonly ExportRecord[] => {
  const typeOnly = statement.exportKind === "type";
  if (statement.declaration !== null && statement.declaration !== undefined) {
    return typeOnly || kind === "type"
      ? []
      : declarationExports(statement.declaration);
  }
  const specifier = statement.source?.value ?? null;
  return statement.specifiers.flatMap((item): ExportRecord[] => {
    const itemTypeOnly =
      typeOnly || (isExportSpecifier(item) && item.exportKind === "type");
    if (itemTypeOnly !== (kind === "type")) {
      return [];
    }
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
    if (!isExportSpecifier(item)) {
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

const exportsOf = (
  program: Program,
  kind: RecordKind = "value"
): readonly ExportRecord[] =>
  program.body.flatMap((statement): readonly ExportRecord[] => {
    if (isExportNamedDeclaration(statement)) {
      return namedExports(statement, kind);
    }
    if (isExportDefaultDeclaration(statement)) {
      // Overload signatures and `export default interface` are types only.
      return kind === "type" ||
        isTSDeclareFunction(statement.declaration) ||
        isTSInterfaceDeclaration(statement.declaration)
        ? []
        : [defaultExport(statement)];
    }
    if (
      isExportAllDeclaration(statement) &&
      (statement.exportKind === "type") === (kind === "type")
    ) {
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
