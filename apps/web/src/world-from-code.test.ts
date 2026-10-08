import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { ExampleName } from "./examples";
import { codeGraphOf, describeRoom, worldFromCode } from "./world-from-code";

const exampleNames = Object.keys(examples) as readonly ExampleName[];

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: ExampleName) => {
  const { codeGraph, error } = codeGraphOf(name);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return codeGraph;
};

describe("worldFromCode", () => {
  it.each(exampleNames)("generates a world from the %s example", (name) => {
    const world = worldFromCode(graphOf(name), 1);
    expect(world.built.rooms.length).toBeGreaterThan(0);
  });

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

  it("resolves the service example's method calls into doors", () => {
    const world = worldFromCode(graphOf("service"), 1);
    expect(world.graph.connections).toEqual(
      expect.arrayContaining([
        {
          from: "service.ts::UserService.load",
          to: "service.ts::UserService.fetchRows",
        },
        {
          from: "service.ts::UserService.load",
          to: "service.ts::UserService.parse",
        },
        {
          from: "service.ts::UserService.create",
          to: "service.ts::UserService.constructor",
        },
        { from: "service.ts::main", to: "service.ts::UserService.create" },
      ])
    );
  });
});
