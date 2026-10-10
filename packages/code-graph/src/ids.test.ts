import { describe, expect, it } from "vitest";

import {
  callPortalId,
  callSiteId,
  flowNodeId,
  functionId,
  isFunctionId,
  isRelativeSpecifier,
  jumpPortalId,
  markerPortalId,
  moduleId,
  modulePortalId,
  normalisePath,
  parseFlowNodeId,
  parsePortalId,
  resolveSpecifier,
  returnPortalId,
  taggedFlowNodeId,
  uniqueNames,
} from "./ids";

describe("normalisePath", () => {
  it.each([
    ["./a//b/../c.ts", "a/c.ts"],
    ["src/./a/../../b.ts", "b.ts"],
    ["../x.ts", "../x.ts"],
    ["a/../../x.ts", "../x.ts"],
    ["src\\a\\..\\b.ts", "src/b.ts"],
    ["/abs//a.ts", "/abs/a.ts"],
  ])("%s → %s", (path, expected) => {
    expect(normalisePath(path)).toBe(expected);
  });
});

describe("resolveSpecifier", () => {
  const ids = new Set([
    "src/a.ts",
    "src/b.ts",
    "src/c.tsx",
    "src/lib/index.ts",
    "src/raw.js",
    "src/util/log.ts",
  ]);

  it.each([
    ["./b", "src/b.ts"],
    ["./b.ts", "src/b.ts"],
    ["./c", "src/c.tsx"],
    ["./raw.js", "src/raw.js"],
    ["./util/log.js", "src/util/log.ts"],
    ["./lib", "src/lib/index.ts"],
    ["../src/b", "src/b.ts"],
    ["./missing", null],
    ["lodash", null],
    ["node:fs", null],
    ["@repo/x", null],
    ["/src/b", null],
    ["../../b", null],
  ])("from src/a.ts, %s → %s", (specifier, expected) => {
    expect(resolveSpecifier("src/a.ts", specifier, ids)).toBe(expected);
  });

  it("resolves from a nested module up and over", () => {
    expect(resolveSpecifier("src/util/log.ts", "../lib", ids)).toBe(
      "src/lib/index.ts"
    );
    expect(resolveSpecifier("top.ts", "./src/b", ids)).toBe("src/b.ts");
  });

  it("tells relative specifiers from packages", () => {
    expect(["./a", "../a", ".", ".."].every(isRelativeSpecifier)).toBe(true);
    expect([".a", "a", "node:fs", "/a"].some(isRelativeSpecifier)).toBe(false);
  });
});

describe("moduleId", () => {
  it("normalises separators and strips a leading ./", () => {
    expect(moduleId("./src/a.ts")).toBe("src/a.ts");
    expect(moduleId("src\\a.ts")).toBe("src/a.ts");
    expect(moduleId("src//a.ts")).toBe("src/a.ts");
    expect(moduleId("././a.ts")).toBe("a.ts");
    expect(moduleId("a.ts")).toBe("a.ts");
  });
});

describe("functionId and callSiteId", () => {
  it("joins module, name and offset readably", () => {
    expect(functionId("demo.ts", "Svc.load")).toBe("demo.ts::Svc.load");
    expect(callSiteId("demo.ts::main", 42)).toBe("demo.ts::main@42");
  });

  it("tells function ids from module ids", () => {
    expect(isFunctionId("demo.ts::main")).toBe(true);
    expect(isFunctionId("demo.ts")).toBe(false);
    expect(isFunctionId("corridor-1")).toBe(false);
  });
});

describe("portal ids", () => {
  it("round-trips call and return portals", () => {
    const call = callPortalId("src/a@b.ts::Svc.load@42");
    expect(call).toBe("portal:src/a@b.ts::Svc.load@42");
    expect(parsePortalId(call)).toEqual({
      kind: "call",
      callSiteId: "src/a@b.ts::Svc.load@42",
    });
    const back = returnPortalId("src/a@b.ts::Svc.load@57:return");
    expect(back).toBe("return:src/a@b.ts::Svc.load@57:return");
    expect(parsePortalId(back)).toEqual({
      kind: "return",
      roomId: "src/a@b.ts::Svc.load@57:return",
    });
  });

  it("round-trips jump portals and tags a composite's rooms", () => {
    const jump = jumpPortalId("m.ts::f@80:continue");
    expect(jump).toBe("jump:m.ts::f@80:continue");
    expect(parsePortalId(jump)).toEqual({
      kind: "jump",
      roomId: "m.ts::f@80:continue",
    });
    expect(taggedFlowNodeId("m.ts::f@12:loop", "again")).toBe(
      "m.ts::f@12:loop:again"
    );
  });

  it("round-trips marker portals", () => {
    const marker = markerPortalId("m.ts::f@12:step");
    expect(marker).toBe("marker:m.ts::f@12:step");
    expect(parsePortalId(marker)).toEqual({
      kind: "marker",
      roomId: "m.ts::f@12:step",
    });
  });

  it("round-trips module portals, whatever their paths hold", () => {
    const portal = modulePortalId("src/index.ts", "src/a>b.ts");
    expect(portal).toBe('module:["src/index.ts","src/a>b.ts"]');
    expect(parsePortalId(portal)).toEqual({
      kind: "module",
      from: "src/index.ts",
      to: "src/a>b.ts",
    });
    expect(modulePortalId("a>b", "c")).not.toBe(modulePortalId("a", "b>c"));
    expect(parsePortalId("module:src/index.ts")).toBeNull();
    expect(parsePortalId('module:["a"]')).toBeNull();
    expect(parsePortalId('module:["a",1]')).toBeNull();
  });

  it("rejects ids that are not portals", () => {
    expect(parsePortalId("corridor-1")).toBeNull();
    expect(parsePortalId("demo.ts::main")).toBeNull();
    expect(parsePortalId("")).toBeNull();
  });
});

describe("flow node ids", () => {
  it("round-trips kinds and tags, splitting on the last @", () => {
    const plain = flowNodeId("src/a@b.ts::Svc.load", 12, "branch");
    expect(plain).toBe("src/a@b.ts::Svc.load@12:branch");
    expect(parseFlowNodeId(plain)).toEqual({
      functionId: "src/a@b.ts::Svc.load",
      offset: 12,
      kind: "branch",
    });
    const tagged = flowNodeId("src/a@b.ts::f", 0, "sequence", "body");
    expect(tagged).toBe("src/a@b.ts::f@0:sequence:body");
    expect(parseFlowNodeId(tagged)).toEqual({
      functionId: "src/a@b.ts::f",
      offset: 0,
      kind: "sequence",
      tag: "body",
    });
    expect(parseFlowNodeId(flowNodeId("t.ts::f", 7, "case"))).toMatchObject({
      kind: "case",
      offset: 7,
    });
  });

  it("rejects call-site, hub, portal, module and malformed ids", () => {
    expect(parseFlowNodeId("demo.ts::main@42")).toBeNull();
    expect(parseFlowNodeId("demo.ts#2")).toBeNull();
    expect(parseFlowNodeId("portal:demo.ts::main@42")).toBeNull();
    expect(parseFlowNodeId("src/@x:y.ts")).toBeNull();
    expect(parseFlowNodeId("demo.ts::main@42:room")).toBeNull();
    expect(parseFlowNodeId("@12:step")).toBeNull();
    expect(parseFlowNodeId("")).toBeNull();
  });
});

describe("uniqueNames", () => {
  it("suffixes repeats in order and leaves distinct names alone", () => {
    const next = uniqueNames();
    expect(next("foo")).toBe("foo");
    expect(next("bar")).toBe("bar");
    expect(next("foo")).toBe("foo~2");
    expect(next("foo")).toBe("foo~3");
    expect(next("bar")).toBe("bar~2");
  });
});
