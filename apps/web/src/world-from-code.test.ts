import { parseFlowNodeId } from "@repo/code-graph/ids";
import type { GeneratedWorld } from "@repo/types";
import { checkLayout } from "@repo/world-generator/layout-checks";
import type { Frame } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { ExampleName } from "./examples";
import {
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "./world-from-code";

const exampleNames = Object.keys(examples) as readonly ExampleName[];

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: ExampleName) => {
  const { codeGraph, error } = codeGraphOf(name);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return codeGraph;
};

const frame = (callerRoomId: string, calleeRoomId: string): Frame => ({
  portalId: null,
  callerRoomId,
  calleeRoomId,
  returnTo: { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } },
});

/** The flow rooms of a function, in flow order. */
const roomsOf = (world: GeneratedWorld, fnId: string) =>
  world.layout.rooms.filter((room) => room.cluster === fnId);

/** The function a portal's room belongs to. */
const ownerOf = (from: string): string =>
  parseFlowNodeId(from)?.functionId ?? from;

describe("worldFromCode", () => {
  it.each(exampleNames)(
    "generates the %s example with every door and portal placed",
    (name) => {
      const codeGraph = graphOf(name);
      for (let seed = 1; seed <= 30; seed += 1) {
        const world = worldFromCode(codeGraph, seed);
        expect(world.built.rooms.length).toBeGreaterThan(0);
        expect(world.layout.unresolved, `seed ${seed}`).toEqual([]);
        expect(world.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
        expect(checkLayout(world.graph, world.layout), `seed ${seed}`).toEqual(
          []
        );
      }
    }
  );

  it("gives the reference demo a hub, five functions as columns of rooms and no leftovers", () => {
    const codeGraph = graphOf("demo");
    const world = worldFromCode(codeGraph, 1);
    expect(world.graph.rooms.map((room) => room.label)).toEqual([
      "demo.ts",
      "main",
      "getUser",
      "showDashboard",
      "showLogin",
      "loadSession",
    ]);
    expect(world.layout.startRoomId).toBe("demo.ts");
    expect(world.layout.unresolved).toEqual([]);
    const main = roomsOf(world, "demo.ts::main");
    expect(main.map((room) => room.role)).toEqual(["call", "collapsed"]);
    expect(describeRoom(codeGraph, main[0]?.id ?? "")).toBe(
      "demo.ts · main() · getUser(…)"
    );
    expect(describeRoom(codeGraph, main[1]?.id ?? "")).toBe(
      "demo.ts · main() · if (user) · 2 statements · 2 calls"
    );
    expect(main[1]?.label).toBe("if (user) · 2 statements · 2 calls");
    const getUser = roomsOf(world, "demo.ts::getUser");
    expect(describeRoom(codeGraph, getUser[0]?.id ?? "")).toBe(
      "demo.ts · getUser() · return loadSession(…)"
    );
    const empty = roomsOf(world, "demo.ts::showLogin");
    expect(describeRoom(codeGraph, empty[0]?.id ?? "")).toBe(
      "demo.ts · showLogin() · empty body"
    );
    expect(describeRoom(codeGraph, "demo.ts")).toBe("demo.ts");
    expect(describeRoom(codeGraph, "demo.ts::getUser")).toBe(
      "demo.ts · getUser()"
    );
    expect(describeRoom(codeGraph, "corridor-1")).toBe("corridor-1");
    expect(describeRoom(null, "hub")).toBe("hub");
  });

  it("names methods by their class in the HUD, and awaits as checkpoints", () => {
    expect(
      describeRoom(graphOf("service"), "service.ts::UserService.load")
    ).toBe("service.ts · UserService.load()");
    const external = graphOf("external");
    const world = worldFromCode(external, 1);
    const main = roomsOf(world, "external.ts::main");
    expect(main.map((room) => room.role)).toEqual([
      "step",
      "await",
      "call",
      "step",
      "return",
    ]);
    expect(describeRoom(external, main[1]?.id ?? "")).toBe(
      "external.ts · main() · await fetch(…)"
    );
  });

  it("resolves the service example's method calls into doors and one portal", () => {
    const world = worldFromCode(graphOf("service"), 1);
    expect(world.graph.connections).toEqual(
      expect.arrayContaining([
        {
          from: "service.ts::UserService.load",
          to: "service.ts::UserService.fetchRows",
          kind: "call",
        },
        {
          from: "service.ts::UserService.load",
          to: "service.ts::UserService.parse",
          kind: "call",
        },
        {
          from: "service.ts::main",
          to: "service.ts::UserService.create",
          kind: "call",
        },
        {
          from: "service.ts::main",
          to: "service.ts::UserService.constructor",
          kind: "call",
        },
      ])
    );
    const calls = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "call"
    );
    expect(calls.map((portal) => [ownerOf(portal.from), portal.to])).toEqual([
      ["service.ts::UserService.create", "service.ts::UserService.constructor"],
    ]);
  });

  it("turns the extra callers and the recursion of the portals example into portals", () => {
    const world = worldFromCode(graphOf("portals"), 1);
    const calls = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "call"
    );
    expect(calls.map((portal) => [ownerOf(portal.from), portal.to])).toEqual([
      ["portals.ts::load", "portals.ts::format"],
      ["portals.ts::render", "portals.ts::format"],
      ["portals.ts::countdown", "portals.ts::countdown"],
    ]);
    expect(world.graph.connections).toContainEqual({
      from: "portals.ts::main",
      to: "portals.ts::format",
      kind: "call",
    });
    expect(world.built.portals).toHaveLength(3 + 5);
  });

  it("words the breadcrumb and the prompts", () => {
    const codeGraph = graphOf("portals");
    const world = worldFromCode(codeGraph, 1);
    const frames = [
      frame("portals.ts::main", "portals.ts::load"),
      frame("portals.ts::load", "portals.ts::format"),
    ];
    expect(breadcrumbOf(codeGraph, frames, "portals.ts::format")).toBe(
      "main() → load() → format()"
    );
    expect(breadcrumbOf(codeGraph, [], "portals.ts")).toBe("portals.ts");
    expect(breadcrumbOf(codeGraph, [], null)).toBeNull();
    expect(breadcrumbOf(null, [], "room-1")).toBeNull();

    const toFormat = world.built.portals.find(
      (portal) =>
        portal.portal.kind === "call" &&
        ownerOf(portal.portal.from) === "portals.ts::load"
    );
    expect(
      promptOf(codeGraph, [], {
        kind: "portal",
        portalId: toFormat?.portal.id ?? "",
      })
    ).toBe("→ format()");
    const exitOfFormat = world.graph.portals?.find(
      (portal) =>
        portal.kind === "return" &&
        ownerOf(portal.from) === "portals.ts::format"
    );
    const exit = { kind: "portal", portalId: exitOfFormat?.id ?? "" } as const;
    expect(promptOf(codeGraph, frames, exit)).toBe("return to load()");
    expect(promptOf(codeGraph, [], exit)).toBe("return to portals.ts");
    const main = roomsOf(world, "portals.ts::main");
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: main[0]?.id ?? "",
        targetRoomId: main[1]?.id ?? "",
      })
    ).toBe("→ render(…)");
    const load = roomsOf(world, "portals.ts::load");
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: main[0]?.id ?? "",
        targetRoomId: load[0]?.id ?? "",
      })
    ).toBe("→ load()");
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: "portals.ts::main",
        targetRoomId: "portals.ts::load",
      })
    ).toBe("→ load()");
    expect(
      promptOf(null, [], { kind: "door", roomId: "a", targetRoomId: "b" })
    ).toBe("→ b");
    expect(promptOf(codeGraph, [], null)).toBeNull();
  });
});
