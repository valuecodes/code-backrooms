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

describe("worldFromCode", () => {
  it.each(exampleNames)(
    "generates the %s example with every door and portal placed",
    (name) => {
      for (let seed = 1; seed <= 5; seed += 1) {
        const world = worldFromCode(graphOf(name), seed);
        expect(world.built.rooms.length).toBeGreaterThan(0);
        expect(world.layout.unresolved, `seed ${seed}`).toEqual([]);
        expect(world.layout.unplacedPortals, `seed ${seed}`).toEqual([]);
      }
    }
  );

  it("gives the reference demo a hub, five function rooms and no leftovers", () => {
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
    expect(describeRoom(codeGraph, "demo.ts")).toBe("demo.ts");
    expect(describeRoom(codeGraph, "demo.ts::getUser")).toBe(
      "demo.ts · getUser()"
    );
    expect(describeRoom(codeGraph, "corridor-1")).toBe("corridor-1");
    expect(describeRoom(null, "hub")).toBe("hub");
  });

  it("names methods by their class in the HUD", () => {
    expect(
      describeRoom(graphOf("service"), "service.ts::UserService.load")
    ).toBe("service.ts · UserService.load()");
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
    expect(calls).toEqual([
      expect.objectContaining({
        from: "service.ts::UserService.create",
        to: "service.ts::UserService.constructor",
      }),
    ]);
  });

  it("turns the extra callers and the recursion of the portals example into portals", () => {
    const world = worldFromCode(graphOf("portals"), 1);
    const calls = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "call"
    );
    expect(calls.map((portal) => [portal.from, portal.to])).toEqual([
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
        portal.portal.from === "portals.ts::load"
    );
    expect(
      promptOf(codeGraph, [], {
        kind: "portal",
        portalId: toFormat?.portal.id ?? "",
      })
    ).toBe("→ format()");
    const exit = {
      kind: "portal",
      portalId: "return:portals.ts::format",
    } as const;
    expect(promptOf(codeGraph, frames, exit)).toBe("return to load()");
    expect(promptOf(codeGraph, [], exit)).toBe("return to portals.ts");
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
