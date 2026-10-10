import type { GeneratedWorld } from "@repo/types";
import { describe, expect, it } from "vitest";

import type { ExampleName } from "./examples";
import { sourceView } from "./source-view";
import {
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const parsed = (name: ExampleName) => {
  const result = codeGraphOf(name);
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
  it("opens the service example's hub onto main and the UserService lobby", () => {
    const { codeGraph, sources } = parsed("service");
    const world = worldFromCode(codeGraph, 1);
    const lobby = "service.ts//class:UserService";
    expect(lobbiesOf(world)).toEqual([lobby]);
    expect(doorsOf(world, "service.ts")).toEqual([lobby, "service.ts::main"]);
    // create and the constructor are reached by doors from main; load by nobody.
    expect(doorsOf(world, lobby)).toEqual(["service.ts::UserService.load"]);
    expect(describeRoom(codeGraph, lobby)).toBe(
      "service.ts · class UserService"
    );
    expect(
      promptOf(codeGraph, [], {
        kind: "door",
        roomId: "service.ts",
        targetRoomId: lobby,
      })
    ).toBe("→ class UserService");
    expect(breadcrumbOf(codeGraph, [], lobby)).toBe("class UserService");
    const view = sourceView(codeGraph, sources, lobby);
    const classLines = (sources.get("service.ts") ?? "")
      .split("\n")
      .findIndex((line) => line === "}");
    expect(view).toMatchObject({
      path: "service.ts",
      fn: "class UserService",
      region: null,
      lines: `1–${classLines + 1}`,
    });
    const first = view?.code[0];
    expect(`${first?.before}${first?.marked}${first?.after}`).toBe(
      "class UserService {"
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
