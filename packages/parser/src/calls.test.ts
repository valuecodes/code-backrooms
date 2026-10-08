import { describe, expect, it } from "vitest";

import { parseModule } from "./parser";

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
