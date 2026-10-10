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

  it("marks runtime globals external, parameters dynamic and the rest unresolved", () => {
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
      ["cb", "dynamic"],
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
    expect(
      parse(source).callSites.map((site) => [site.calleeName, site.via])
    ).toEqual([
      ["factory", undefined],
      ["target", undefined],
      ["console.log", undefined],
      ["fetch", { localName: "fetch", member: null, isNew: false }],
      ["target", undefined],
    ]);
  });

  it("marks calls through imports with how they reach the binding", () => {
    const source = [
      'import { helper, Svc } from "./h";',
      'import * as ns from "./ns";',
      'import { console } from "./log";',
      "function run() {",
      "  helper(); ns.run(); new Svc(); Svc.make(); ns.a.b();",
      "  helper?.(); console.log(); new ns.Svc(); new ns.a.B();",
      "}",
      "function shadow() { const helper = 1 as never; helper(); }",
    ].join("\n");
    expect(
      parse(source).callSites.map((site) => [
        site.calleeName,
        site.resolution,
        site.via,
      ])
    ).toEqual([
      [
        "helper",
        "unresolved",
        { localName: "helper", member: null, isNew: false },
      ],
      [
        "ns.run",
        "unresolved",
        { localName: "ns", member: "run", isNew: false },
      ],
      ["Svc", "unresolved", { localName: "Svc", member: null, isNew: true }],
      [
        "Svc.make",
        "unresolved",
        { localName: "Svc", member: "make", isNew: false },
      ],
      ["ns.a.b", "unresolved", undefined],
      [
        "helper",
        "unresolved",
        { localName: "helper", member: null, isNew: false },
      ],
      [
        "console.log",
        "unresolved",
        { localName: "console", member: "log", isNew: false },
      ],
      ["ns.Svc", "unresolved", { localName: "ns", member: "Svc", isNew: true }],
      ["ns.a.B", "unresolved", undefined],
      ["helper", "unresolved", undefined],
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
      ["t.ts::run", "target", "dynamic", null],
      ["t.ts::run", "target", "dynamic", null],
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
      // `this` is dynamic in a plain function; both classes S declare x.
      ["t.ts::S.run.inner", "this.x", "ambiguous", null],
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

describe("resolution kinds", () => {
  const kinds = (source: string) =>
    parse(source).callSites.map((site) => [site.calleeName, site.resolution]);

  it("marks calls computed at run time dynamic", () => {
    const source = [
      "function helper() { return helper; }",
      "type F = () => void;",
      "function run(cb: () => void, obj: Record<string, F>, k: string, a?: F, b?: F) {",
      "  cb(); cb!(); obj[k](); helper()(); (a || b)!(); (helper as F)();",
      "  [1].forEach((each: F) => each());",
      "}",
    ].join("\n");
    expect(kinds(source)).toEqual([
      ["cb", "dynamic"],
      ["cb", "dynamic"],
      ["obj[…]", "dynamic"],
      ["helper", "resolved"],
      ["helper(…)", "dynamic"],
      ["<LogicalExpression>", "dynamic"],
      ["helper", "resolved"],
      ["<ArrayExpression>.forEach", "unresolved"],
      ["each", "dynamic"],
    ]);
  });

  it("tells apart the calls of a chain that start at one offset", () => {
    const graph = parse("function a() { b()(); }\nfunction b() { return b; }");
    expect(
      graph.callSites.map((site) => [site.id, site.calleeName, site.resolution])
    ).toEqual([
      ["t.ts::a@15", "b", "resolved"],
      ["t.ts::a@15-20", "b(…)", "dynamic"],
    ]);
    expect(graph.edges.filter((edge) => edge.type === "call")).toEqual([
      {
        type: "call",
        source: "t.ts::a",
        target: "t.ts::b",
        callSiteIds: ["t.ts::a@15"],
      },
    ]);
  });

  it("makes a name declared in several branches ambiguous, with no edge", () => {
    const graph = parse(
      [
        "function run(flag: boolean) {",
        "  if (flag) { function pick() { return 1; } } else { function pick() { return 2; } }",
        "  return pick();",
        "}",
      ].join("\n")
    );
    const site = graph.callSites.find((each) => each.calleeName === "pick");
    expect(site).toMatchObject({
      resolution: "ambiguous",
      calleeId: null,
      candidateIds: ["t.ts::run.pick", "t.ts::run.pick~2"],
    });
    expect(graph.edges.filter((edge) => edge.type === "call")).toEqual([]);
  });

  it("makes an unknown receiver ambiguous only with two candidate classes", () => {
    const source = [
      "class A { render() {} }",
      "class B { render() {} draw() {} }",
      "function run(x: A | B) { x.render(); x.draw(); }",
    ].join("\n");
    expect(parse(source).callSites).toMatchObject([
      {
        calleeName: "x.render",
        resolution: "ambiguous",
        candidateIds: ["t.ts::A.render", "t.ts::B.render"],
      },
      { calleeName: "x.draw", resolution: "unresolved", calleeId: null },
    ]);
    expect(parse(source).callSites[1]).not.toHaveProperty("candidateIds");
  });

  it("looks for this.m() missing on its own class among the others", () => {
    const source = [
      "class A { m() {} }",
      "class B { m() {} }",
      "class C { run() { this.m(); this.#p(); } #p() {} }",
      "class D { #p() {} }",
    ].join("\n");
    expect(kinds(source)).toEqual([
      ["this.m", "ambiguous"],
      ["this.#p", "resolved"],
    ]);
  });

  it("resolves through TypeScript overload signatures", () => {
    const source = [
      "function f(a: string): void;",
      "function f(a: number): void;",
      "function f(a: unknown) {}",
      "class S {",
      "  m(a: string): void;",
      "  m(a: unknown) {}",
      "  run() { this.m(1); }",
      "}",
      "function main() { f(1); }",
    ].join("\n");
    expect(sites(source)).toEqual([
      ["t.ts::S.run", "this.m", "resolved", "t.ts::S.m"],
      ["t.ts::main", "f", "resolved", "t.ts::f"],
    ]);
  });

  it("keeps super and IIFEs unresolved; import() is no call site", () => {
    const source = [
      "class A { m() {} }",
      "class B extends A { constructor() { super(); } m() { super.m(); } }",
      "class C extends A { m() { super.m(); } }",
      "async function run() { (() => 1)(); await import('./x'); }",
    ].join("\n");
    expect(kinds(source)).toEqual([
      ["super", "unresolved"],
      ["super.m", "unresolved"],
      ["super.m", "unresolved"],
      ["<ArrowFunctionExpression>", "unresolved"],
    ]);
  });
});
