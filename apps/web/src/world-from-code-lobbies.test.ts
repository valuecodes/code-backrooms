import type { GeneratedWorld } from "@repo/types";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import type { BundledName } from "./examples";
import { sourceView } from "./source-view";
import {
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const parsed = (name: BundledName) => {
  const result = codeGraphOf(examples[name]);
  if (result.error !== null) {
    throw new Error(`${name}: ${result.error}`);
  }
  return result;
};

const lobbiesOf = (world: GeneratedWorld) =>
  world.graph.rooms
    .filter((room) => room.id.includes("//class:"))
    .map((room) => room.id);

/** What the room opens onto through plain doors. */
const doorsOf = (world: GeneratedWorld, roomId: string) =>
  world.graph.connections
    .filter(({ from, kind }) => from === roomId && kind === undefined)
    .map(({ to }) => to);

describe("class lobbies", () => {
  it("needs no lobby once main reaches every UserService method", () => {
    const { codeGraph } = parsed("service");
    const world = worldFromCode(codeGraph, 1);
    // `other` holds a `new UserService(…)`, so `other.load()` is a door from
    // main like create and the constructor: no method is left for a lobby.
    expect(lobbiesOf(world)).toEqual([]);
    expect(doorsOf(world, "service.ts")).toEqual(["service.ts::main"]);
    expect(codeGraph.edges).toContainEqual(
      expect.objectContaining({
        type: "call",
        source: "service.ts::main",
        target: "service.ts::UserService.load",
      })
    );
  });

  it("names and shows a class lobby in the HUD", () => {
    const { codeGraph, sources } = parsed("repo");
    const path = "src/handlers/auth.ts";
    const lobby = `${path}//class:Session`;
    expect(describeRoom(codeGraph, lobby)).toBe(`${path} · class Session`);
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: path,
        targetRoomId: lobby,
      })
    ).toBe("→ class Session");
    expect(breadcrumbOf(codeGraph, [], lobby)).toBe("class Session");
    const view = sourceView(codeGraph, sources, lobby);
    const lines = (sources.get(path) ?? "").split("\n");
    const start = lines.findIndex((line) => line.startsWith("export class"));
    const end = lines.findIndex((line) => line === "}");
    expect(view).toMatchObject({
      path,
      fn: "class Session",
      region: null,
      lines: `${start + 1}–${end + 1}`,
    });
    const first = view?.code[0];
    expect(`${first?.before}${first?.marked}${first?.after}`).toBe(
      "export class Session {"
    );
    expect(view?.code.every((line) => line.marked === "")).toBe(true);
  });

  it("gives the repo example's Session class a lobby", () => {
    const { codeGraph } = parsed("repo");
    const world = worldFromCode(codeGraph, 1);
    const lobby = "src/handlers/auth.ts//class:Session";
    expect(lobbiesOf(world)).toEqual([lobby]);
    // handleRequest is called from server.ts only, so it is no root: the
    // leftover pass attaches what it reaches in source order, the
    // constructor and open first.
    expect(doorsOf(world, lobby)).toEqual([
      "src/handlers/auth.ts::Session.constructor",
      "src/handlers/auth.ts::Session.open",
      "src/handlers/auth.ts::Session.refresh",
    ]);
  });

  it("gives each class of the resolution example its own lobby", () => {
    const { codeGraph } = parsed("resolution");
    const world = worldFromCode(codeGraph, 1);
    expect(lobbiesOf(world)).toEqual([
      "resolution.ts//class:Circle",
      "resolution.ts//class:Square",
    ]);
    expect(doorsOf(world, "resolution.ts//class:Square")).toEqual([
      "resolution.ts::Square.render",
    ]);
  });
});
