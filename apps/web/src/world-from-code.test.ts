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
    expect(main.map((room) => room.role)).toEqual([
      "call",
      "fork",
      "call",
      "call",
      "merge",
    ]);
    expect(main.map((room) => room.lane?.kind)).toEqual([
      undefined,
      undefined,
      "true",
      "false",
      undefined,
    ]);
    expect(describeRoom(codeGraph, main[0]?.id ?? "")).toBe(
      "demo.ts · main() · getUser(…)"
    );
    expect(describeRoom(codeGraph, main[1]?.id ?? "")).toBe(
      "demo.ts · main() · if (user)"
    );
    expect(describeRoom(codeGraph, main[2]?.id ?? "")).toBe(
      "demo.ts · main() · showDashboard(…)"
    );
    expect(describeRoom(codeGraph, main[4]?.id ?? "")).toBe(
      "demo.ts · main() · end if"
    );
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
    // Five functions end in a return portal; countdown's early return adds one.
    expect(world.built.portals).toHaveLength(3 + 6);
    const countdown = roomsOf(world, "portals.ts::countdown");
    expect(countdown.map((room) => room.role)).toEqual([
      "fork",
      "return",
      "lane",
      "merge",
      "return",
    ]);
  });

  it("lays a switch out as a head room with a door per case", () => {
    const codeGraph = graphOf("switches");
    const world = worldFromCode(codeGraph, 1);
    const route = roomsOf(world, "switches.ts::route");
    expect(route.map((room) => [room.role, room.label])).toEqual([
      ["switch", "switch (status)"],
      ["return", "return showDashboard(…)"],
      ["call", "showBanned(…)"],
      ["call", "showLogin(…)"],
      ["merge", "end switch"],
      ["call", "track(…)"],
    ]);
    expect(route[1]?.lane).toEqual({
      kind: "case",
      text: 'case "active", case "trial"',
    });
    expect(route[3]?.lane).toEqual({ kind: "default" });
    expect(describeRoom(codeGraph, route[4]?.id ?? "")).toBe(
      "switches.ts · route() · end switch"
    );
    // The middle case touches no outer wall, so its call is a portal and
    // showBanned hangs off the hub instead.
    const calls = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "call"
    );
    expect(calls.map((portal) => [ownerOf(portal.from), portal.to])).toEqual([
      ["switches.ts::route", "switches.ts::showBanned"],
    ]);
    expect(world.graph.connections).toContainEqual({
      from: "switches.ts",
      to: "switches.ts::showBanned",
    });
    const prompts = (route[0]?.doors ?? []).map((door) =>
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: route[0]?.id ?? "",
        targetRoomId: door.targetRoomId,
        ...(door.lane === undefined ? {} : { lane: door.lane }),
      })
    );
    expect(prompts).toEqual(
      expect.arrayContaining([
        '→ case "active", case "trial"',
        '→ case "banned"',
        "→ default",
      ])
    );
  });

  it("nests an else-if inside the false lane and names empty lanes", () => {
    const codeGraph = graphOf("branches");
    const world = worldFromCode(codeGraph, 1);
    const main = roomsOf(world, "branches.ts::main");
    expect(main.map((room) => room.role)).toEqual([
      "call",
      "fork",
      "return",
      "lane",
      "merge",
      "fork",
      "call",
      "fork",
      "call",
      "call",
      "merge",
      "merge",
      "call",
    ]);
    expect(describeRoom(codeGraph, main[3]?.id ?? "")).toBe(
      "branches.ts · main() · false · empty"
    );
    expect(main[7]?.lane).toEqual({ kind: "false" });
    expect(main[8]?.lane).toEqual({ kind: "true" });
    const fork = main[1];
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: fork?.id ?? "",
        targetRoomId: main[2]?.id ?? "",
        lane: { kind: "true" },
      })
    ).toBe("→ true");
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: main[3]?.id ?? "",
        targetRoomId: main[4]?.id ?? "",
      })
    ).toBe("→ end if");
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
