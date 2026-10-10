import {
  ENTRANCE_ID,
  modulePortalId,
  parseFlowNodeId,
} from "@repo/code-graph/ids";
import type { Point } from "@repo/types";
import { mergeAreas } from "@repo/world-generator/areas";
import { roomBounds } from "@repo/world-generator/geometry";
import { containsPoint } from "@repo/world-generator/locate";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import { sourceView } from "./source-view";
import {
  areasFromCode,
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
} from "./world-from-code";

/** The repo example, parsed, or the test fails with the parser's message. */
const parsed = () => {
  const result = codeGraphOf("repo");
  if (result.codeGraph === null) {
    throw new Error(`repo: ${result.error}`);
  }
  return result;
};

const ownerOf = (roomId: string): string =>
  parseFlowNodeId(roomId)?.functionId ?? roomId;

describe("the repo example", () => {
  const { codeGraph, sources } = parsed();
  const areas = areasFromCode(codeGraph, 1);
  const world = mergeAreas(areas);
  const prompt = (portalId: string) =>
    promptOf(codeGraph, [], { kind: "portal", portalId });

  /** The area holding `point`, by the rooms its unit `unit` stands in. */
  const landsIn = (unit: string, point: Point | undefined): string | null => {
    if (point === undefined) {
      return null;
    }
    const area = areas.areas.find((candidate) =>
      candidate.layout.rooms.some(
        (room) =>
          (room.id === unit || room.cluster === unit) &&
          containsPoint(roomBounds(room), point)
      )
    );
    return area?.id ?? null;
  };

  it("has a module per file, sorted by path", () => {
    expect(codeGraph.modules.map((module) => module.id)).toEqual([
      "src/config.ts",
      "src/handlers/auth.ts",
      "src/handlers/index.ts",
      "src/handlers/render.ts",
      "src/index.ts",
      "src/server.ts",
      "src/util/log.ts",
    ]);
  });

  it("lays each file out as its own area and starts in the entrance", () => {
    expect(areas.areas.map((area) => area.id)).toEqual([
      ENTRANCE_ID,
      ...codeGraph.modules.map((module) => module.id),
    ]);
    expect(areas.entry).toBe(ENTRANCE_ID);
    expect(areas.areas.find((area) => area.id === ENTRANCE_ID)?.offset).toEqual(
      { x: 0, z: 0 }
    );
    expect(world.graph.start).toBe(ENTRANCE_ID);
    expect(world.layout.startRoomId).toBe(ENTRANCE_ID);
  });

  it("leads from the entrance to src/index.ts alone, named after src", () => {
    const fromEntrance = world.built.portals.filter(
      ({ portal }) => portal.from === ENTRANCE_ID
    );
    expect(fromEntrance.map(({ portal }) => prompt(portal.id))).toEqual([
      "→ src/index.ts",
    ]);
    expect(landsIn("src/index.ts", fromEntrance[0]?.arrival?.position)).toBe(
      "src/index.ts"
    );
    expect(describeRoom(codeGraph, ENTRANCE_ID)).toBe("src");
    expect(breadcrumbOf(codeGraph, [], ENTRANCE_ID)).toBe("src");
    expect(sourceView(codeGraph, sources, ENTRANCE_ID)).toBeNull();
  });

  it("returns home to the entrance with an empty stack", () => {
    const navigator = createNavigator(world);
    const portal = modulePortalId(ENTRANCE_ID, "src/index.ts");
    const entered = navigator.step(navigator.initial, {
      type: "portal",
      portalId: portal,
    });
    expect(entered.state).toEqual({ frames: [], roomId: "src/index.ts" });
    const home = navigator.step(entered.state, { type: "home" });
    expect(home.state).toEqual({ frames: [], roomId: ENTRANCE_ID });
    expect(home.teleport).toEqual({
      position: world.built.start,
      facing: world.built.facing,
    });
  });

  it("leads from a hub to the files it imports", () => {
    const modulePortals = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "module"
    );
    expect(
      modulePortals
        .filter((portal) => portal.from === "src/index.ts")
        .map((portal) => prompt(portal.id))
    ).toEqual(["→ src/server.ts", "→ src/config.ts"]);
    for (const portal of modulePortals) {
      const built = world.built.portals.find(
        (candidate) => candidate.portal.id === portal.id
      );
      expect(landsIn(portal.to, built?.arrival?.position)).toBe(portal.to);
    }
  });

  it("walks a call into another file and back, and empties the stack at a hub", () => {
    const navigator = createNavigator(world);
    const call = world.built.portals.find(
      ({ portal }) =>
        portal.kind === "call" && portal.to === "src/server.ts::startServer"
    );
    if (call === undefined) {
      throw new Error("No call portal to startServer");
    }
    expect(landsIn("src/server.ts::startServer", call.arrival?.position)).toBe(
      "src/server.ts"
    );
    const inMain = navigator.step(navigator.initial, {
      type: "room",
      roomId: call.portal.from,
    }).state;
    const entered = navigator.step(inMain, {
      type: "portal",
      portalId: call.portal.id,
    });
    expect(entered.state.roomId).toBe("src/server.ts::startServer");
    expect(entered.state.frames).toHaveLength(1);
    const back = navigator.step(entered.state, { type: "back" });
    expect(back.state).toEqual(inMain);
    expect(back.teleport).toEqual(call.returnPoint);
    const across = navigator.step(entered.state, {
      type: "portal",
      portalId: modulePortalId("src/server.ts", "src/util/log.ts"),
    });
    expect(across.state).toEqual({ frames: [], roomId: "src/util/log.ts" });
  });

  it("follows calls across files with call portals", () => {
    const crossing = (world.graph.portals ?? [])
      .filter((portal) => portal.kind === "call")
      .map((portal) => [ownerOf(portal.from), portal.to, prompt(portal.id)])
      .filter(([from, to]) => from?.split("::")[0] !== to?.split("::")[0]);
    expect(crossing).toEqual(
      expect.arrayContaining([
        ["src/index.ts::main", "src/server.ts::startServer", "→ startServer()"],
        ["src/server.ts::startServer", "src/util/log.ts::log", "→ log()"],
        [
          "src/server.ts::startServer",
          "src/handlers/auth.ts::handleRequest",
          "→ handleRequest()",
        ],
        [
          "src/server.ts::startServer",
          "src/handlers/render.ts::render",
          "→ render()",
        ],
        [
          "src/handlers/auth.ts::handleRequest",
          "src/handlers/render.ts::render",
          "→ render()",
        ],
      ])
    );
  });

  it("names the package call and leaves the unknown receiver closed", () => {
    const prompts = world.built.portals
      .filter(({ portal }) => portal.kind === "marker")
      .map(({ portal }) => prompt(portal.id));
    expect(prompts).toContain(
      'closed · console.log(…) external, format(…) package "node:util"'
    );
    expect(prompts).toContain("closed · session.refresh(…) unresolved");
  });

  it("shows each module's own source", () => {
    expect(sources.get("src/server.ts")).toContain(
      "export function startServer"
    );
    const view = sourceView(codeGraph, sources, "src/server.ts::startServer");
    expect(view?.path).toBe("src/server.ts");
    const text = view?.code
      .map((line) => `${line.before}${line.marked}${line.after}`)
      .join("\n");
    expect(text).toContain("handleRequest(request);");
  });
});
