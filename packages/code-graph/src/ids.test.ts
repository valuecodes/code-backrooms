import { describe, expect, it } from "vitest";

import {
  callPortalId,
  callSiteId,
  flowNodeId,
  functionId,
  isFunctionId,
  moduleId,
  parseFlowNodeId,
  parsePortalId,
  returnPortalId,
  uniqueNames,
} from "./ids";

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
