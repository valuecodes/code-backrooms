import { describe, expect, it } from "vitest";

import { buildCodeGraph, parseModule } from "./parser";

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

describe("call resolution", () => {
  it("resolves identifiers, this, static and new against the module", () => {
    const source = [
      "function helper() {}",
      "class Svc {",
      "  constructor() {}",
      "  load() { this.fetchRows(); helper(); }",
      "  fetchRows() {}",
      "  static create() { return new Svc(); }",
      "}",
      "function main() { Svc.create(); new Svc(); }",
    ].join("\n");
    expect(sites(source)).toEqual([
      ["t.ts::Svc.load", "this.fetchRows", "resolved", "t.ts::Svc.fetchRows"],
      ["t.ts::Svc.load", "helper", "resolved", "t.ts::helper"],
      ["t.ts::Svc.create", "Svc", "resolved", "t.ts::Svc.constructor"],
      ["t.ts::main", "Svc.create", "resolved", "t.ts::Svc.create"],
      ["t.ts::main", "Svc", "resolved", "t.ts::Svc.constructor"],
    ]);
  });

  it("marks runtime globals external and the rest unresolved", () => {
    const source = [
      'import { chunk } from "lodash";',
      "function run(obj: { method(): void }, cb?: () => void) {",
      "  console.log(1); Math.max(1, 2); fetch('/'); new Map();",
      "  globalThis.crypto.randomUUID();",
      "  unknown(); obj.method(); chunk([]); cb?.(); new Thing();",
      "}",
    ].join("\n");
    expect(
      sites(source).map(([, name, resolution]) => [name, resolution])
    ).toEqual([
      ["console.log", "external"],
      ["Math.max", "external"],
      ["fetch", "external"],
      ["Map", "external"],
      ["globalThis.crypto.randomUUID", "external"],
      ["unknown", "unresolved"],
      ["obj.method", "unresolved"],
      ["chunk", "unresolved"],
      ["cb", "unresolved"],
      ["Thing", "unresolved"],
    ]);
    expect(parse(source).callSites.map((site) => site.kind)).toContain(
      "optional-call"
    );
  });

  it("lets local bindings shadow functions and globals", () => {
    const source = [
      'import { fetch } from "undici";',
      "function target() {}",
      "function factory() { return target; }",
      "function run(console: { log(): void }) {",
      "  const target = factory();",
      "  target(); console.log(); fetch('/');",
      "}",
      "function block() { if (true) { const target = 1; } target(); }",
    ].join("\n");
    expect(sites(source)).toEqual([
      ["t.ts::run", "factory", "resolved", "t.ts::factory"],
      ["t.ts::run", "target", "unresolved", null],
      ["t.ts::run", "console.log", "unresolved", null],
      ["t.ts::run", "fetch", "unresolved", null],
      ["t.ts::block", "target", "unresolved", null],
    ]);
  });

  it("keeps callback and object-method parameters in their own scope", () => {
    const source = [
      "function target() {}",
      "function run(xs: string[]) {",
      "  xs.map((target) => target());",
      "  const obj = { method(target: () => void) { target(); } };",
      "  target();",
      "  return obj;",
      "}",
    ].join("\n");
    expect(sites(source)).toEqual([
      ["t.ts::run", "xs.map", "unresolved", null],
      ["t.ts::run", "target", "unresolved", null],
      ["t.ts::run", "target", "unresolved", null],
      ["t.ts::run", "target", "resolved", "t.ts::target"],
    ]);
  });

  it("binds a function expression's own name to itself", () => {
    const source =
      "function recur() {}\nconst f = function recur() { recur(); };\nconst g = [function again() { again(); }];";
    expect(sites(source)).toEqual([
      ["t.ts::f", "recur", "resolved", "t.ts::f"],
      ["t.ts", "again", "unresolved", null],
    ]);
  });

  it("scopes classes lexically and this per function kind", () => {
    const source = [
      "class S {",
      "  x() {}",
      "  run() {",
      "    this.x();",
      "    function inner() { this.x(); }",
      "    const arrow = () => this.x();",
      "    inner(); arrow();",
      "  }",
      "}",
      "function f() { class S { x() {} } new S(); S.x(); }",
      "const E = class { y() {} z() { this.y(); } };",
    ].join("\n");
    expect(names(source)).toEqual([
      "S.x",
      "S.run",
      "S.run.inner",
      "S.run.arrow",
      "f",
      "f.S.x",
    ]);
    expect(sites(source)).toEqual([
      ["t.ts::S.run", "this.x", "resolved", "t.ts::S.x"],
      ["t.ts::S.run.inner", "this.x", "unresolved", null],
      ["t.ts::S.run.arrow", "this.x", "resolved", "t.ts::S.x"],
      ["t.ts::S.run", "inner", "resolved", "t.ts::S.run.inner"],
      ["t.ts::S.run", "arrow", "resolved", "t.ts::S.run.arrow"],
      ["t.ts::f", "S", "unresolved", null],
      ["t.ts::f", "S.x", "unresolved", null],
      ["t.ts", "this.y", "unresolved", null],
    ]);
  });

  it("treats super and classes without a constructor as unresolved", () => {
    const source = [
      "class Base { run() {} }",
      "class Child extends Base { run() { super.run(); new Base(); } }",
    ].join("\n");
    expect(
      sites(source).map(([, name, resolution]) => [name, resolution])
    ).toEqual([
      ["super.run", "unresolved"],
      ["Base", "unresolved"],
    ]);
  });

  it("marks only the direct operand of await as awaited", () => {
    const { callSites } = parse(
      "async function a() { await foo(bar()); baz(); }\nfunction foo(x: number) {}\nfunction bar() { return 1; }\nfunction baz() {}"
    );
    expect(callSites.map((site) => [site.calleeName, site.awaited])).toEqual([
      ["foo", true],
      ["bar", false],
      ["baz", false],
    ]);
  });

  it("attributes top-level calls to the module and creates no edge", () => {
    const graph = parse("function main() {}\nmain();");
    expect(graph.callSites).toMatchObject([
      { callerId: "t.ts", calleeName: "main", resolution: "resolved" },
    ]);
    expect(graph.edges.filter((edge) => edge.type === "call")).toEqual([]);
  });

  it("merges repeated calls into one edge and keeps recursion", () => {
    const graph = parse("function a() { b(); b(); a(); }\nfunction b() {}");
    expect(graph.edges.filter((edge) => edge.type === "call")).toEqual([
      {
        type: "call",
        source: "t.ts::a",
        target: "t.ts::b",
        callSiteIds: ["t.ts::a@15", "t.ts::a@20"],
      },
      {
        type: "call",
        source: "t.ts::a",
        target: "t.ts::a",
        callSiteIds: ["t.ts::a@25"],
      },
    ]);
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
    });
  });

  it("reports syntax errors with the path in front", () => {
    expect(() => parse("function (", "bad.ts")).toThrow(/^bad\.ts: /);
  });
});

describe("buildCodeGraph", () => {
  it("keeps file order and rejects duplicate paths", () => {
    const graph = buildCodeGraph([
      { path: "b.ts", source: "function b() {}" },
      { path: "a.ts", source: "function a() {}" },
    ]);
    expect(graph.modules.map((module) => module.id)).toEqual(["b.ts", "a.ts"]);
    expect(graph.functions.map((fn) => fn.id)).toEqual(["b.ts::b", "a.ts::a"]);
    expect(() =>
      buildCodeGraph([
        { path: "a.ts", source: "" },
        { path: "./a.ts", source: "" },
      ])
    ).toThrow(/Duplicate module path/);
  });
});
