import { describe, expect, it } from "vitest";

import { demoGraph, fixtureGraph } from "./fixture";
import { layoutFlow, planFlow } from "./flow-layout";
import { parseFlowNodeId } from "./ids";
import { portalSubject, roomSubject } from "./subjects";
import { toWorldGraph } from "./world-graph";

/** The call portal id for the first site from `caller` to `callee`. */
const callPortalId = (
  graph: ReturnType<typeof fixtureGraph>,
  caller: string,
  callee: string
): string => {
  const site = graph.callSites.find(
    (candidate) =>
      candidate.callerId === caller && candidate.calleeId === callee
  );
  return `portal:${site?.id ?? "?"}`;
};

describe("roomSubject", () => {
  const graph = demoGraph();

  it("names modules, functions and flow rooms, and nothing else", () => {
    expect(roomSubject(graph, "demo.ts")).toMatchObject({
      kind: "module",
      module: { path: "demo.ts" },
    });
    expect(roomSubject(graph, "demo.ts::getUser")).toMatchObject({
      kind: "function",
      fn: { name: "getUser" },
      module: { path: "demo.ts" },
    });
    const main = graph.functions[0];
    const [first, second] = main?.flow.steps ?? [];
    expect(roomSubject(graph, first?.id ?? "")).toMatchObject({
      kind: "flow",
      fn: { name: "main" },
      module: { path: "demo.ts" },
      node: { kind: "step" },
      ancestors: [{ kind: "sequence" }],
      text: "9 statements",
    });
    expect(roomSubject(graph, second?.id ?? "")).toMatchObject({
      kind: "flow",
      text: "getUser(…)",
    });
    expect(roomSubject(graph, "demo.ts::main@99999:step")).toBeNull();
    expect(roomSubject(graph, "demo.ts::nobody@0:step:empty")).toBeNull();
    expect(roomSubject(graph, "corridor-1")).toBeNull();
    expect(roomSubject(graph, "other.ts::getUser")).toBeNull();
  });
});

describe("portalSubject", () => {
  const graph = fixtureGraph({
    path: "m.ts",
    functions: [
      { name: "main", calls: ["shared"] },
      { name: "other", calls: ["shared"] },
      { name: "shared" },
    ],
  });

  it("names the call site and both functions of a call portal", () => {
    const portal = callPortalId(graph, "m.ts::other", "m.ts::shared");
    expect(portalSubject(graph, portal)).toMatchObject({
      kind: "call",
      site: { callerId: "m.ts::other" },
      caller: { name: "other" },
      callee: { name: "shared" },
    });
  });

  it("names the function of a return portal by its flow room", () => {
    const exit = toWorldGraph(graph).portals?.find(
      (portal) =>
        portal.kind === "return" &&
        parseFlowNodeId(portal.from)?.functionId === "m.ts::shared"
    );
    expect(portalSubject(graph, exit?.id ?? "")).toMatchObject({
      kind: "return",
      fn: { name: "shared" },
    });
    expect(portalSubject(graph, "return:m.ts::shared")).toMatchObject({
      kind: "return",
      fn: { name: "shared" },
    });
  });

  it("returns null for anything else", () => {
    expect(portalSubject(graph, "corridor-1")).toBeNull();
    expect(portalSubject(graph, "portal:m.ts::nobody@1")).toBeNull();
    expect(portalSubject(graph, "return:m.ts::nobody")).toBeNull();
    expect(portalSubject(graph, "return:m.ts::nobody@3:step")).toBeNull();
    expect(portalSubject(graph, "jump:m.ts::main@3:break")).toBeNull();
    expect(portalSubject(graph, "jump:hub")).toBeNull();
  });
});

describe("roomSubject folded rooms", () => {
  it("describes a room folded into budget by what it holds", () => {
    const graph = fixtureGraph({
      path: "m.ts",
      functions: [
        { name: "big", calls: Array.from({ length: 40 }, () => "a") },
        { name: "a" },
      ],
    });
    const big = graph.functions[0];
    if (big === undefined) {
      throw new Error("no function");
    }
    const sites = graph.callSites.filter((site) => site.callerId === big.id);
    const folded = layoutFlow(planFlow(big, sites)).rooms.find(
      (room) => room.role === "collapsed"
    );
    expect(folded).toBeDefined();
    const subject = roomSubject(graph, folded?.id ?? "");
    expect(subject).toMatchObject({ kind: "flow", text: folded?.label });
    expect(folded?.label).toMatch(/^\d+ statements · \d+ calls$/);
  });
});
