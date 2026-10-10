import { describe, expect, it } from "vitest";

import { parseModule } from "./parser";

const parse = (source: string, path = "t.ts") => parseModule({ path, source });

const imports = (source: string) =>
  parse(source).module.imports.map((record) => [
    record.localName,
    record.importedName,
    record.specifier,
    record.moduleId,
  ]);

const exports = (source: string) =>
  parse(source).module.exports.map((record) => [
    record.exportedName,
    record.localName,
    record.specifier,
    record.importedName,
  ]);

describe("import records", () => {
  it("records default, named, aliased, namespace and string imports", () => {
    expect(
      imports(
        [
          'import d, { a, b as x } from "./a";',
          'import * as ns from "../b";',
          'import { "kebab-name" as k } from "pkg";',
        ].join("\n")
      )
    ).toEqual([
      ["d", "default", "./a", null],
      ["a", "a", "./a", null],
      ["x", "b", "./a", null],
      ["ns", "*", "../b", null],
      ["k", "kebab-name", "pkg", null],
    ]);
  });

  it("keeps side-effect imports as unnamed dependencies", () => {
    expect(imports('import "./setup";\nimport {} from "./empty";')).toEqual([
      [null, null, "./setup", null],
      [null, null, "./empty", null],
    ]);
  });

  it("skips type-only imports and import-equals", () => {
    expect(
      imports(
        [
          'import type { T } from "./types";',
          'import { type U, v } from "./mixed";',
          'import fs = require("fs");',
        ].join("\n")
      )
    ).toEqual([["v", "v", "./mixed", null]]);
  });

  it("spans the specifier", () => {
    const [record] = parse('import { a } from "./a";').module.imports;
    expect(record?.span).toMatchObject({ start: 9, startLine: 1 });
  });
});

describe("export records", () => {
  it("records declarations, including destructured variables", () => {
    expect(
      exports(
        [
          "export function f() {}",
          "export class C {}",
          "export const g = () => {}, { a, b: [c] } = api;",
        ].join("\n")
      )
    ).toEqual([
      ["f", "f", null, null],
      ["C", "C", null, null],
      ["g", "g", null, null],
      ["a", "a", null, null],
      ["c", "c", null, null],
    ]);
  });

  it("records export lists with aliases", () => {
    expect(
      exports("function a() {}\nconst b = 1;\nexport { a, b as bee };")
    ).toEqual([
      ["a", "a", null, null],
      ["bee", "b", null, null],
    ]);
  });

  it.each([
    ["export default function run() {}", "run"],
    ["export default function () {}", "default"],
    ["export default class Svc {}", "Svc"],
    ["export default class {}", "default"],
    ["export default () => {};", "default"],
    ["export default function* () {}", "default"],
    ["const c = 1;\nexport default c;", "c"],
    ["export default 1 + 2;", null],
  ])("names the default target of %j", (source, localName) => {
    expect(exports(source)).toEqual([["default", localName, null, null]]);
  });

  it("records re-exports with their source and imported name", () => {
    expect(
      exports(
        [
          'export { x } from "./x";',
          'export { y as why, default as z } from "./y";',
          'export * from "./all";',
          'export * as ns from "./ns";',
        ].join("\n")
      )
    ).toEqual([
      ["x", null, "./x", "x"],
      ["why", null, "./y", "y"],
      ["z", null, "./y", "default"],
      ["*", null, "./all", "*"],
      ["ns", null, "./ns", "*"],
    ]);
  });

  it("skips type-only exports and export-equals", () => {
    expect(
      exports(
        [
          "export type T = string;",
          "export interface I {}",
          "type U = number;",
          "export type { U };",
          'export type * from "./types";',
          "const v = 1;",
          "export { type U as W, v };",
          "export declare function d(): void;",
        ].join("\n")
      )
    ).toEqual([["v", "v", null, null]]);
    expect(exports("const x = 1;\nexport = x;")).toEqual([]);
  });

  it("keeps a named default function exported without exporting its name", () => {
    const { module, functions } = parse("export default function run() {}");
    expect(module.exports.map((record) => record.exportedName)).toEqual([
      "default",
    ]);
    expect(functions.map((fn) => [fn.name, fn.exported])).toEqual([
      ["run", true],
    ]);
  });
});
