import { layoutFlow, planFlow } from "@repo/code-graph/flow-layout";
import { markerPortalId } from "@repo/code-graph/ids";
import { describe, expect, it } from "vitest";

import { parseModule } from "./parser";

/**
 * Plans `f` of the source and checks the marker contract: every call the
 * world cannot follow is on exactly one marker, of a room the cluster
 * places, which has that marker on its wall. Returns each call's room by
 * callee name.
 */
const roomsOfOpenCalls = (source: string): ReadonlyMap<string, string> => {
  const graph = parseModule({ path: "t.ts", source });
  const fn = graph.functions.find((candidate) => candidate.id === "t.ts::f");
  if (fn === undefined) {
    throw new Error("no function f");
  }
  const sites = graph.callSites.filter((site) => site.callerId === fn.id);
  const plan = planFlow(fn, sites);
  const cluster = layoutFlow(plan);
  const rooms = new Set(cluster.rooms.map((room) => room.id));
  const markers = new Set(
    cluster.portals
      .filter((portal) => portal.kind === "marker")
      .map((portal) => portal.id)
  );
  const marked = [...plan.markers.keys()];
  // Every marked room is placed and carries its marker, and nothing else does.
  expect(marked.filter((roomId) => !rooms.has(roomId))).toEqual([]);
  expect(marked.map(markerPortalId).toSorted()).toEqual(
    [...markers].toSorted()
  );
  // Each open call is on exactly one marker.
  const shown = [...plan.markers.values()].flat();
  const open = sites.filter((site) => site.resolution !== "resolved");
  expect(shown.toSorted()).toEqual(open.map((site) => site.id).toSorted());
  const nameOf = new Map(sites.map((site) => [site.id, site.calleeName]));
  return new Map(
    [...plan.markers].flatMap(([roomId, ids]) =>
      ids.map((id) => [nameOf.get(id) ?? id, roomId] as const)
    )
  );
};

const tagOf = (roomId: string | undefined): string =>
  roomId?.replace(/^t\.ts::f@\d+:/u, "") ?? "none";

describe("markers on parsed code", () => {
  it("puts a statement's open calls in its own room", () => {
    const rooms = roomsOfOpenCalls(
      "function f(x: any) {\n  g();\n  x.a();\n  g();\n}\nfunction g() {}"
    );
    expect(tagOf(rooms.get("x.a"))).toBe("step");
  });

  it("puts conditions on the head, with or without else", () => {
    const withElse = roomsOfOpenCalls(
      "function f(x: any) {\n  if (x.ok()) { x.yes(); } else { x.no(); }\n  g();\n}\nfunction g() {}"
    );
    expect(tagOf(withElse.get("x.ok"))).toBe("branch");
    expect(tagOf(withElse.get("x.yes"))).toBe("step");
    const bare = roomsOfOpenCalls(
      "function f(x: any) {\n  if (x.ok()) { g(); }\n  g();\n}\nfunction g() {}"
    );
    expect(tagOf(bare.get("x.ok"))).toBe("branch");
  });

  it("puts a switch's discriminant and case tests on the head", () => {
    const rooms = roomsOfOpenCalls(
      [
        "function f(x: any) {",
        "  switch (x.kind()) {",
        "    case x.key(): g(); break;",
        "    default: x.other();",
        "  }",
        "}",
        "function g() {}",
      ].join("\n")
    );
    expect(tagOf(rooms.get("x.kind"))).toBe("switch");
    expect(tagOf(rooms.get("x.key"))).toBe("switch");
    expect(tagOf(rooms.get("x.other"))).toBe("step");
  });

  it("puts a do-while's condition on its test room", () => {
    const rooms = roomsOfOpenCalls(
      "function f(x: any) {\n  do { g(); } while (x.more());\n}\nfunction g() {}"
    );
    expect(tagOf(rooms.get("x.more"))).toBe("loop:again");
  });

  it("keeps a try's calls in its one room", () => {
    const rooms = roomsOfOpenCalls(
      "function f(x: any) {\n  try { x.a(); } catch { x.b(); }\n  g();\n}\nfunction g() {}"
    );
    expect(tagOf(rooms.get("x.a"))).toBe("try");
    expect(tagOf(rooms.get("x.b"))).toBe("try");
  });

  it("gives default-parameter calls and dead code to the entry room", () => {
    const rooms = roomsOfOpenCalls(
      [
        "function f(x: any, y = x.make()) {",
        "  g();",
        "  return y;",
        "  x.dead();",
        "}",
        "function g() {}",
      ].join("\n")
    );
    expect(rooms.get("x.make")).toMatch(/:call$/u);
    expect(rooms.get("x.dead")).toBe(rooms.get("x.make"));
  });
});
