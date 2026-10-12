import type { CallSite, CodeGraph } from "@repo/code-graph";
import { describe, expect, it } from "vitest";

import { buildCodeGraph, parseModule } from "./parser";

/** The one call site whose callee reads `calleeName`. */
const only = (sites: readonly CallSite[], calleeName: string): CallSite => {
  const found = sites.filter((site) => site.calleeName === calleeName);
  const [site] = found;
  if (site === undefined || found.length > 1) {
    throw new Error(`not exactly one call to ${calleeName}`);
  }
  return site;
};

/** Where one call goes: its resolution and callee or candidates. */
const target = (site: CallSite) => [
  site.resolution,
  site.resolution === "ambiguous" ? site.candidateIds : site.calleeId,
];

const call = (source: string, calleeName: string) =>
  target(only(parseModule({ path: "t.ts", source }).callSites, calleeName));

const graphOf = (files: Readonly<Record<string, string>>): CodeGraph =>
  buildCodeGraph(
    Object.entries(files).map(([path, source]) => ({ path, source }))
  );

const linked = (files: Readonly<Record<string, string>>, calleeName: string) =>
  target(only(graphOf(files).callSites, calleeName));

const svc = "class Svc { run() {} stop() {} }";

describe("typed receivers in one module", () => {
  it("resolves a variable holding a new instance", () => {
    expect(
      call(`${svc}\nfunction main() { const s = new Svc(); s.run(); }`, "s.run")
    ).toEqual(["resolved", "t.ts::Svc.run"]);
  });

  it("resolves annotated variables and parameters, generics and optionals", () => {
    const source = [
      svc,
      "class Box<T> { open() {} }",
      "function a(s: Svc) { s.run(); }",
      "function b(box: Box<number>) { box.open(); }",
      "function c(s?: Svc | undefined) { s?.stop(); }",
      "function d(s: Svc | null = null) { let t: Svc; t = s!; t.run(); }",
    ].join("\n");
    const sites = parseModule({ path: "t.ts", source }).callSites;
    expect(sites.map(target)).toEqual([
      ["resolved", "t.ts::Svc.run"],
      ["resolved", "t.ts::Box.open"],
      ["resolved", "t.ts::Svc.stop"],
      ["resolved", "t.ts::Svc.run"],
    ]);
  });

  it("resolves typed fields, parameter properties and private fields", () => {
    const source = [
      svc,
      "class App {",
      "  a: Svc;",
      "  b = new Svc();",
      "  #c: Svc;",
      "  constructor(private d: Svc) {}",
      "  go() { this.a.run(); this.b.run(); this.#c.stop(); this.d?.stop(); }",
      "}",
    ].join("\n");
    const sites = parseModule({ path: "t.ts", source }).callSites.filter(
      (site) => site.kind !== "new"
    );
    expect(sites.map((site) => [site.calleeName, ...target(site)])).toEqual([
      ["this.a.run", "resolved", "t.ts::Svc.run"],
      ["this.b.run", "resolved", "t.ts::Svc.run"],
      ["this.#c.stop", "resolved", "t.ts::Svc.stop"],
      ["this.d.stop", "resolved", "t.ts::Svc.stop"],
    ]);
  });

  it("follows inherited members and a class declared later", () => {
    const source = [
      "function main(s: Child) { s.run(); s.own(); }",
      "class Child extends Base { own() { this.run(); } }",
      "class Base { run() {} }",
    ].join("\n");
    const sites = parseModule({ path: "t.ts", source }).callSites;
    expect(sites.map((site) => [site.calleeName, ...target(site)])).toEqual([
      ["s.run", "resolved", "t.ts::Base.run"],
      ["s.own", "resolved", "t.ts::Child.own"],
      ["this.run", "resolved", "t.ts::Base.run"],
    ]);
  });

  it("makes a call ambiguous when a subclass overrides the member", () => {
    const source = [
      "class Base { run() {} }",
      "class Fast extends Base { run() {} }",
      "class Slow extends Fast { run() {} }",
      "function main(s: Base) { s.run(); }",
    ].join("\n");
    expect(call(source, "s.run")).toEqual([
      "ambiguous",
      ["t.ts::Base.run", "t.ts::Fast.run", "t.ts::Slow.run"],
    ]);
  });

  it("keeps an exact instance from its subclasses' overrides", () => {
    const source = [
      "class Base { run() {} }",
      "class Fast extends Base { run() {} }",
      "function main() { const s = new Base(); s.run(); }",
    ].join("\n");
    expect(call(source, "s.run")).toEqual(["resolved", "t.ts::Base.run"]);
  });

  it("resolves an abstract member to its one implementation", () => {
    const source = [
      "abstract class Shape { abstract area(): number; }",
      "class Square extends Shape { area() { return 1; } }",
      "function main(s: Shape) { s.area(); }",
    ].join("\n");
    expect(call(source, "s.area")).toEqual(["resolved", "t.ts::Square.area"]);
  });

  it("leaves a member missing from the typed class unresolved, not guessed", () => {
    const source = [
      svc,
      "class Other { jump() {} }",
      "class Third { jump() {} }",
      "function main(s: Svc) { s.jump(); }",
    ].join("\n");
    expect(call(source, "s.jump")).toEqual(["unresolved", null]);
  });

  it("keeps today's result where no class is known", () => {
    const source = [
      "interface Runner { run(): void }",
      "class A { run() {} }",
      "class B { run() {} }",
      "function main(r: Runner, m: Map<string, A>, u: A | B, l: A[]) {",
      "  r.run(); m.get('x'); u.run(); l.pop();",
      "}",
    ].join("\n");
    const sites = parseModule({ path: "t.ts", source }).callSites;
    expect(sites.map((site) => [site.calleeName, site.resolution])).toEqual([
      ["r.run", "ambiguous"],
      ["m.get", "unresolved"],
      ["u.run", "ambiguous"],
      ["l.pop", "unresolved"],
    ]);
  });

  it("drops a class inferred from new once the name is written", () => {
    const source = [
      "class A { m() {} }",
      "class B { m() {} }",
      "function main() { let x = new A(); x = new B(); x.m(); }",
      "function typed() { let y: A = new A(); y = new A(); y.m(); }",
    ].join("\n");
    expect(call(source, "x.m")).toEqual([
      "ambiguous",
      ["t.ts::A.m", "t.ts::B.m"],
    ]);
    expect(call(source, "y.m")).toEqual(["resolved", "t.ts::A.m"]);
  });

  it("drops a field's inferred class once any object writes the field", () => {
    const source = [
      svc,
      "class App { s = new Svc(); go() { this.s.run(); } }",
      "function swap(app: App) { app.s = null!; }",
    ].join("\n");
    expect(call(source, "this.s.run")).toEqual(["unresolved", null]);
  });

  it("drops a field's inferred class on a computed write", () => {
    const fieldCall = (write: string) =>
      call(
        [
          svc,
          `class App { s = new Svc(); go() { this.s.run(); } swap() { ${write}; } }`,
        ].join("\n"),
        "this.s.run"
      );
    expect(fieldCall("this.t = null")).toEqual(["resolved", "t.ts::Svc.run"]);
    expect(fieldCall('this["s"] = null!')).toEqual(["unresolved", null]);
    expect(fieldCall("const k = 's'; this[k] = null!")).toEqual([
      "unresolved",
      null,
    ]);
  });

  it("lets inner and conflicting bindings hide a type", () => {
    const source = [
      svc,
      "class Other { run() {} }",
      "function outer(s: Svc) { const f = (s) => s.run(); f(s); }",
      "function folded(flag: boolean) {",
      "  if (flag) { const t = new Svc(); t.stop(); }",
      "  else { const t = new Other(); t.run(); }",
      "}",
    ].join("\n");
    const sites = parseModule({ path: "t.ts", source }).callSites;
    // The untyped arrow parameter hides `s: Svc`; the two `t`s, folded into
    // one scope, disagree, so neither keeps a class: today's results.
    expect(
      sites
        .filter((site) => site.kind !== "new" && site.calleeName !== "f")
        .map((site) => [site.calleeName, site.resolution])
    ).toEqual([
      ["s.run", "ambiguous"],
      ["t.stop", "unresolved"],
      ["t.run", "ambiguous"],
    ]);
  });

  it("stops field lookup at a subclass's untyped redeclaration", () => {
    const source = [
      svc,
      "class Base { s: Svc; }",
      "class Child extends Base { s; go() { this.s.run(); } }",
    ].join("\n");
    expect(call(source, "this.s.run")).toEqual(["unresolved", null]);
  });

  it("never reaches a static member through an instance", () => {
    const source = [
      "class Svc { static make() {} }",
      "function main(s: Svc) { s.make(); }",
    ].join("\n");
    expect(call(source, "s.make")).toEqual(["unresolved", null]);
  });
});

describe("typed receivers across files", () => {
  const svcFile = "export class Svc { run() {} }";

  it("resolves through value and type-only imports", () => {
    for (const line of [
      'import { Svc } from "./svc";',
      'import type { Svc } from "./svc";',
      'import { type Svc } from "./svc";',
    ]) {
      expect(
        linked(
          {
            "a.ts": `${line}\nexport function main(s: Svc) { s.run(); }`,
            "svc.ts": svcFile,
          },
          "s.run"
        )
      ).toEqual(["resolved", "svc.ts::Svc.run"]);
    }
  });

  it("follows barrels, type-only re-exports and default exports", () => {
    expect(
      linked(
        {
          "a.ts":
            'import type { Svc } from "./index";\nfunction main(s: Svc) { s.run(); }',
          "index.ts": 'export type { Svc } from "./svc";',
          "svc.ts": svcFile,
        },
        "s.run"
      )
    ).toEqual(["resolved", "svc.ts::Svc.run"]);
    expect(
      linked(
        {
          "a.ts":
            'import type { Svc } from "./index";\nfunction main(s: Svc) { s.run(); }',
          "index.ts": 'export * from "./svc";',
          "svc.ts": svcFile,
        },
        "s.run"
      )
    ).toEqual(["resolved", "svc.ts::Svc.run"]);
    expect(
      linked(
        {
          "a.ts":
            'import Svc from "./svc";\nfunction main() { const s = new Svc(); s.run(); }',
          "svc.ts": "export default class Svc { run() {} }",
        },
        "s.run"
      )
    ).toEqual(["resolved", "svc.ts::Svc.run"]);
  });

  it("widens a call by overrides in subclasses in other files", () => {
    const graph = graphOf({
      "a.ts": [
        'import { Base } from "./base";',
        "export function main(b: Base) { b.run(); }",
        "export function exact() { const b = new Base(); b.run(); }",
      ].join("\n"),
      "base.ts": "export class Base { run() {} }",
      "fast.ts":
        'import { Base } from "./base";\nexport class Fast extends Base { run() {} }',
    });
    const sites = graph.callSites.filter((site) => site.calleeName === "b.run");
    expect(sites.map(target)).toEqual([
      ["ambiguous", ["base.ts::Base.run", "fast.ts::Fast.run"]],
      ["resolved", "base.ts::Base.run"],
    ]);
    // The widened call is no longer a call edge; the exact one still is.
    const edges = graph.edges.flatMap((edge) =>
      edge.type === "call" ? [[edge.source, edge.target]] : []
    );
    expect(edges).toEqual([["a.ts::exact", "base.ts::Base.run"]]);
  });

  it("widens a local class's call by an override in another file", () => {
    const graph = graphOf({
      "base.ts": [
        "export class Base { run() {} }",
        "export function main(b: Base) { b.run(); }",
      ].join("\n"),
      "fast.ts":
        'import { Base } from "./base";\nexport class Fast extends Base { run() {} }',
    });
    expect(target(only(graph.callSites, "b.run"))).toEqual([
      "ambiguous",
      ["base.ts::Base.run", "fast.ts::Fast.run"],
    ]);
    expect(graph.edges.some((edge) => edge.type === "call")).toBe(false);
  });

  it("follows members inherited from a superclass in another file", () => {
    const files = {
      "base.ts": "export class Base { run() {} }",
      "child.ts":
        'import { Base } from "./base";\nexport class Child extends Base { own() {} }',
    };
    expect(
      linked(
        {
          ...files,
          "a.ts":
            'import type { Child } from "./child";\nfunction main(c: Child) { c.run(); }',
        },
        "c.run"
      )
    ).toEqual(["resolved", "base.ts::Base.run"]);
    // A local class extending an imported one, typed or created.
    const local = [
      'import { Base } from "./base";',
      "class Local extends Base {}",
      "function typed(l: Local) { l.run(); }",
      "function made() { const m = new Local(); m.run(); }",
    ].join("\n");
    const graph = graphOf({ ...files, "a.ts": local });
    expect(target(only(graph.callSites, "l.run"))).toEqual([
      "resolved",
      "base.ts::Base.run",
    ]);
    expect(target(only(graph.callSites, "m.run"))).toEqual([
      "resolved",
      "base.ts::Base.run",
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "call",
        source: "a.ts::made",
        target: "base.ts::Base.run",
      })
    );
  });

  it("keeps a package class unresolved, naming it as the receiver's class", () => {
    const site = only(
      graphOf({
        "a.ts":
          'import type { Logger } from "pino";\nfunction main(log: Logger) { log.info(); }',
      }).callSites,
      "log.info"
    );
    expect(site).toMatchObject({
      resolution: "unresolved",
      via: { localName: "Logger", member: "info", instance: true },
    });
  });

  it("keeps type-only imports off the module and its links", () => {
    const graph = graphOf({
      "a.ts": 'import type { Svc } from "./svc";\nfunction main(s: Svc) {}',
      "svc.ts": svcFile,
    });
    // Module links (areas joined in the world) are read from these imports.
    expect(graph.modules[0]?.imports).toEqual([]);
  });
});
