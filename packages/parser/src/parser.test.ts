import { hashString } from "@repo/world-generator/random";
import { describe, expect, it } from "vitest";

import { buildCodeGraph, hashSource, parseModule } from "./parser";

const parse = (source: string, path = "t.ts") => parseModule({ path, source });

const names = (source: string, path?: string) =>
  parse(source, path).functions.map((fn) => fn.qualifiedName);

const sites = (source: string) =>
  parse(source).callSites.map((site) => [
    site.callerId,
    site.calleeName,
    site.resolution,
    site.calleeId,
  ]);

describe("function discovery", () => {
  it("finds declarations with ids, kinds, lines and export flags", () => {
    const { functions } = parse(
      "function foo() {}\n\nexport function bar() {\n  return 1;\n}\n"
    );
    expect(functions).toMatchObject([
      {
        id: "t.ts::foo",
        name: "foo",
        kind: "declaration",
        exported: false,
        async: false,
        span: { startLine: 1, endLine: 1 },
        parentId: null,
        className: null,
      },
      {
        id: "t.ts::bar",
        kind: "declaration",
        exported: true,
        span: { startLine: 3, endLine: 5 },
      },
    ]);
  });

  it("names default exports and keeps named default functions", () => {
    expect(names("export default function () {}")).toEqual(["default"]);
    expect(names("export default function run() {}")).toEqual(["run"]);
    expect(names("export default () => {}")).toEqual(["default"]);
  });

  it("marks functions exported by list or default identifier", () => {
    const { functions } = parse(
      [
        "function a() {}",
        "const b = () => {};",
        "function c() {}",
        "class D { m() {} }",
        "function e() { function inner() {} }",
        "export { a, b as bee, D };",
        "export default c;",
        'export { e } from "./other";',
      ].join("\n")
    );
    expect(functions.map((fn) => [fn.qualifiedName, fn.exported])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["D.m", true],
      ["e", false],
      ["e.inner", false],
    ]);
  });

  it("makes rooms for private arrow fields and skips odd string keys", () => {
    expect(
      names("class S {\n  #h = () => {};\n  'ok'() {}\n  'not::ok'() {}\n}")
    ).toEqual(["S.#h", "S.ok"]);
  });

  it("resolves new on a plain function to that function", () => {
    expect(
      sites("function Foo() {}\nfunction make() { return new Foo(); }")
    ).toEqual([["t.ts::make", "Foo", "resolved", "t.ts::Foo"]]);
  });

  it("refuses pathologically deep input with the path in front", () => {
    const deep = `function f() { return a${".b".repeat(3000)}(); }`;
    expect(() => parse(deep, "deep.ts")).toThrow(/^deep\.ts: .*nested/);
  });

  it("finds arrows and function expressions bound by declarators", () => {
    const { functions } = parse(
      "const f = () => {};\nexport const g = async function () {};\nlet h = 1;"
    );
    expect(functions).toMatchObject([
      { name: "f", kind: "arrow", exported: false },
      { name: "g", kind: "expression", exported: true, async: true },
    ]);
  });

  it("finds class members with qualified names", () => {
    const { functions } = parse(
      [
        "class Svc {",
        "  constructor() {}",
        "  load() {}",
        "  static create() {}",
        "  get size() { return 1; }",
        "  set size(value: number) {}",
        "  #hidden() {}",
        "  handle = () => {};",
        "}",
      ].join("\n")
    );
    expect(functions).toMatchObject([
      {
        qualifiedName: "Svc.constructor",
        kind: "constructor",
        className: "Svc",
      },
      { qualifiedName: "Svc.load", kind: "method", isStatic: false },
      { qualifiedName: "Svc.create", kind: "method", isStatic: true },
      { qualifiedName: "Svc.size", kind: "getter" },
      { qualifiedName: "Svc.size~2", kind: "setter" },
      { qualifiedName: "Svc.#hidden", kind: "method" },
      { qualifiedName: "Svc.handle", kind: "arrow", className: "Svc" },
    ]);
  });

  it("qualifies nested named functions and links them to their parent", () => {
    const { functions, edges } = parse(
      "function outer() {\n  function inner() { deep(); }\n  const deep = () => {};\n  inner();\n}"
    );
    expect(functions.map((fn) => [fn.qualifiedName, fn.parentId])).toEqual([
      ["outer", null],
      ["outer.inner", "t.ts::outer"],
      ["outer.deep", "t.ts::outer"],
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        { type: "containment", source: "t.ts", target: "t.ts::outer" },
        {
          type: "containment",
          source: "t.ts::outer",
          target: "t.ts::outer.inner",
        },
        {
          type: "call",
          source: "t.ts::outer",
          target: "t.ts::outer.inner",
          callSiteIds: [expect.stringMatching(/^t\.ts::outer@\d+$/)],
        },
        {
          type: "call",
          source: "t.ts::outer.inner",
          target: "t.ts::outer.deep",
          callSiteIds: [expect.any(String)],
        },
      ])
    );
  });

  it("nests functions declared inside callbacks under the enclosing room", () => {
    const graph = parse(
      "function outer() {\n  [1].map(() => {\n    function inner() {}\n    inner();\n  });\n}"
    );
    expect(
      graph.functions.map((fn) => [fn.qualifiedName, fn.parentId])
    ).toEqual([
      ["outer", null],
      ["outer.inner", "t.ts::outer"],
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          type: "containment",
          source: "t.ts::outer",
          target: "t.ts::outer.inner",
        },
        expect.objectContaining({
          type: "call",
          source: "t.ts::outer",
          target: "t.ts::outer.inner",
        }),
      ])
    );
  });

  it("does not make rooms for anonymous callbacks but keeps their calls", () => {
    const graph = parse(
      "function a(items: number[]) {\n  return items.map((x) => b(x));\n}\nfunction b(x: number) { return x; }"
    );
    expect(graph.functions.map((fn) => fn.name)).toEqual(["a", "b"]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "call",
        source: "t.ts::a",
        target: "t.ts::b",
      })
    );
  });

  it("suffixes duplicate names deterministically", () => {
    expect(names("var f = () => {};\nvar f = () => {};")).toEqual(["f", "f~2"]);
  });
});

describe("parseModule", () => {
  it("is deterministic and orders everything by offset", () => {
    const source =
      "function z() { y(); }\nfunction y() { x(); }\nfunction x() {}";
    const first = parse(source);
    expect(first).toEqual(parse(source));
    const offsets = first.functions.map((fn) => fn.span.start);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    const callOffsets = first.callSites.map((site) => site.span.start);
    expect(callOffsets).toEqual([...callOffsets].sort((a, b) => a - b));
  });

  it("parses TypeScript, TSX, plain JS and generics casts", () => {
    expect(
      names(
        "interface A { x: number }\nenum E { One }\nfunction g<T>(v: T): T { return v as T; }\nconst c = <number>(1 as unknown);"
      )
    ).toEqual(["g"]);
    expect(
      names("const View = () => <div onClick={() => go()} />;", "v.tsx")
    ).toEqual(["View"]);
    expect(names("function plain() { return <b>x</b>; }", "p.jsx")).toEqual([
      "plain",
    ]);
    expect(parse("function js() {}", "j.js").module).toMatchObject({
      id: "j.js",
      language: "javascript",
      lineCount: 1,
    });
  });

  it("normalises the module path and counts lines", () => {
    expect(parse("\n\nfunction a() {}\n", "./src//a.ts").module).toEqual({
      id: "src/a.ts",
      path: "src/a.ts",
      language: "typescript",
      lineCount: 3,
      imports: [],
      exports: [],
    });
  });

  it("reports syntax errors with the path in front", () => {
    expect(() => parse("function (", "bad.ts")).toThrow(/^bad\.ts: /);
  });
});

describe("buildCodeGraph", () => {
  it("sorts modules by path and rejects duplicate paths", () => {
    const graph = buildCodeGraph([
      { path: "b.ts", source: "function b() {}" },
      { path: "./a.ts", source: "function a() {}" },
    ]);
    expect(graph.modules.map((module) => module.id)).toEqual(["a.ts", "b.ts"]);
    expect(graph.functions.map((fn) => fn.id)).toEqual(["a.ts::a", "b.ts::b"]);
    expect(() =>
      buildCodeGraph([
        { path: "a.ts", source: "" },
        { path: "./a.ts", source: "" },
      ])
    ).toThrow(/Duplicate module path/);
  });
});

/** What `hashSource` hashes for one file `a.ts` holding `n`. */
const hashedText = (n: number) => `a.ts\0${n}\0`;

describe("hashSource", () => {
  const file = { path: "a.ts", source: "export const a = 1;\n" };

  it("is the same for the same files and changes with a path or a byte", () => {
    expect(hashSource([file])).toBe(hashSource([{ ...file }]));
    expect(hashSource([{ ...file, path: "b.ts" }])).not.toBe(
      hashSource([file])
    );
    expect(hashSource([{ ...file, source: "export const a = 2;\n" }])).not.toBe(
      hashSource([file])
    );
    // Moving text from the path into the source is a different program.
    expect(hashSource([{ path: "ab", source: "c" }])).not.toBe(
      hashSource([{ path: "a", source: "bc" }])
    );
  });

  it("does not depend on the order the files come in", () => {
    const other = { path: "b.ts", source: "export const b = 2;\n" };
    expect(hashSource([file, other])).toBe(hashSource([other, file]));
  });

  it("folds a 32-bit hash above the URL's range back into it", () => {
    // The first source whose raw FNV-1a is past 2^31 - 1.
    let index = 0;
    while (hashString(hashedText(index)) <= 2 ** 31 - 1) {
      index += 1;
    }
    const raw = hashString(hashedText(index));
    expect(raw).toBeGreaterThan(2 ** 31 - 1);
    expect(hashSource([{ path: "a.ts", source: `${index}` }])).toBe(
      raw - 2 ** 31
    );
  });

  it("stays within the seeds a URL can carry", () => {
    for (let index = 0; index < 200; index += 1) {
      const seed = hashSource([{ path: `m${index}.ts`, source: `${index}` }]);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
});
