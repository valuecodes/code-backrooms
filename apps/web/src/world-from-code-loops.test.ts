import { buildCodeGraph } from "@repo/parser";
import type { RoomData } from "@repo/types";
import { checkAreas } from "@repo/world-generator/area-checks";
import { roomBounds } from "@repo/world-generator/geometry";
import { containsPoint } from "@repo/world-generator/locate";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import {
  areasFromCode,
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: "loops" | "switches") => {
  const { codeGraph, error } = codeGraphOf(name);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return codeGraph;
};

/** The door of `from` that leads to `to`. */
const door = (from: RoomData | undefined, to: RoomData | undefined) =>
  from?.doors.find((candidate) => candidate.targetRoomId === to?.id);

/** A function whose loop makes its column wider than a plain one. */
const looping = (name: string) =>
  `function ${name}(xs: { ok(): void }[]) { for (const x of xs) { x.ok(); } }`;

describe("loops", () => {
  it("lays the loops example out as rings with repeat and exit doors at the bottom", () => {
    const codeGraph = graphOf("loops");
    const generated = worldFromCode(codeGraph, 1);
    const main = generated.layout.rooms.filter(
      (room) => room.cluster === "loops.ts::main"
    );
    expect(main.map((room) => room.role)).toEqual([
      "call",
      "loop-head",
      "fork",
      "jump",
      "lane",
      "merge",
      "call",
      "loop-back",
      "loop-test",
      "loop-end",
      "step",
      "loop-head",
      "fork",
      "jump",
      "lane",
      "merge",
      "step",
      "loop-back",
      "loop-test",
      "loop-end",
      "loop-head",
      "call",
      "loop-back",
      "loop-test",
      "loop-end",
      "call",
    ]);
    const [, head, , , , , , back, test, end] = main;
    expect(
      [head, test, back, end].map((room) =>
        describeRoom(codeGraph, room?.id ?? "")
      )
    ).toEqual([
      "loops.ts · main() · for (const item of items)",
      "loops.ts · main() · again?",
      "loops.ts · main() · repeat",
      "loops.ts · main() · end for",
    ]);
    const doDoWhile = main.filter((room) => room.role === "loop-test")[2];
    expect(describeRoom(codeGraph, doDoWhile?.id ?? "")).toBe(
      "loops.ts · main() · while (pending())"
    );
    // Only the door's own side walks with the flow and names the lane.
    expect(door(test, back)).toMatchObject({ forward: true });
    expect(door(back, test)?.forward).toBeUndefined();
    const prompt = (from: RoomData | undefined, to: RoomData | undefined) => {
      const found = door(from, to);
      return promptOf(codeGraph, [], {
        kind: "door",
        roomId: from?.id ?? "",
        targetRoomId: to?.id ?? "",
        ...(found?.forward === true && found.lane !== undefined
          ? { lane: found.lane }
          : {}),
      });
    };
    expect(prompt(head, main[2])).toBe("→ body");
    expect(prompt(main[6], test)).toBe("→ again?");
    expect(prompt(test, back)).toBe("→ repeat");
    expect(prompt(back, head)).toBe("→ for (const item of items)");
    expect(prompt(test, end)).toBe("→ exit");
    expect(prompt(back, test)).toBe("→ again?");
    expect(prompt(end, test)).toBe("→ again?");
  });

  it("jumps from continue to the loop's test room and from break to its end", () => {
    const codeGraph = graphOf("loops");
    const generated = worldFromCode(codeGraph, 1);
    const byId = new Map(
      generated.layout.rooms.map((room) => [room.id, room] as const)
    );
    const jumps = generated.built.portals.filter(
      (built) => built.portal.kind === "jump"
    );
    expect(
      jumps.map(({ portal }) => [
        describeRoom(codeGraph, portal.from),
        describeRoom(codeGraph, portal.to),
        portal.label,
      ])
    ).toEqual([
      [
        "loops.ts · main() · continue",
        "loops.ts · main() · again?",
        "continue",
      ],
      ["loops.ts · main() · break", "loops.ts · main() · end while", "break"],
    ]);
    expect(
      jumps.map(({ portal }) =>
        promptOf(codeGraph, [], { kind: "portal", portalId: portal.id })
      )
    ).toEqual(["→ again?", "→ end while"]);
    // Each lands inside its target, facing the way on: from `again?` the
    // exit door into `end for`, from `end while` the door to the do-while.
    const onward = jumps.map(({ portal, arrival }) => {
      const target = byId.get(portal.to);
      expect(
        target !== undefined &&
          arrival !== null &&
          containsPoint(roomBounds(target), arrival.position)
      ).toBe(true);
      return generated.layout.rooms
        .filter(
          (room) =>
            room.cluster === "loops.ts::main" &&
            room.id !== portal.to &&
            arrival !== null &&
            containsPoint(roomBounds(room), arrival.facing)
        )
        .map((room) => room.role);
    });
    expect(onward).toEqual([["loop-end"], ["loop-head"]]);
    // A jump stays in the function: the stack is untouched.
    const navigator = createNavigator(generated);
    const [first] = jumps;
    const entered = navigator.step(navigator.initial, {
      type: "room",
      roomId: first?.portal.from ?? null,
    }).state;
    const jumped = navigator.step(entered, {
      type: "portal",
      portalId: first?.portal.id ?? "",
    });
    expect(jumped.teleport).toEqual(first?.arrival);
    expect(jumped.state.frames).toEqual(entered.frames);
    expect(jumped.state.roomId).toBe("loops.ts::main");
  });

  it("lands a continue in a do-while facing the exit, not its condition's call", () => {
    const codeGraph = buildCodeGraph([
      {
        path: "poll.ts",
        source:
          "function main() { do { if (skip()) { continue; } work(); } while (more()); }\nfunction skip() { return false; }\nfunction work() {}\nfunction more() { return false; }",
      },
    ]);
    for (const seed of [1, 2, 3]) {
      const generated = worldFromCode(codeGraph, seed);
      const jump = generated.built.portals.find(
        (built) => built.portal.kind === "jump"
      );
      const test = generated.layout.rooms.find(
        (room) => room.id === jump?.portal.to
      );
      expect(test?.role).toBe("loop-test");
      // The test room also has the door to more(); the jump faces the exit.
      expect(
        test?.doors.some(
          (candidate) => !candidate.targetRoomId.startsWith("poll.ts::main")
        )
      ).toBe(true);
      const facing = generated.layout.rooms.filter(
        (room) =>
          room.id !== test?.id &&
          jump !== undefined &&
          jump.arrival !== null &&
          containsPoint(roomBounds(room), jump.arrival.facing)
      );
      expect(facing.map((room) => room.role)).toEqual(["loop-end"]);
    }
  });

  it("jumps from a break nested in a case to the end switch room", () => {
    const codeGraph = graphOf("switches");
    const world = worldFromCode(codeGraph, 1);
    const jumps = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "jump"
    );
    expect(
      jumps.map((portal) => [
        describeRoom(codeGraph, portal.from),
        describeRoom(codeGraph, portal.to),
        promptOf(codeGraph, [], { kind: "portal", portalId: portal.id }),
      ])
    ).toEqual([
      [
        "switches.ts · route() · break",
        "switches.ts · route() · end switch",
        "→ end switch",
      ],
    ]);
  });

  it("keeps a loop whose body ends in a return collapsed, and lays it out", () => {
    const codeGraph = buildCodeGraph([
      {
        path: "find.ts",
        source:
          "function find(xs: number[]) { for (const x of xs) { if (x > 1) { log(); } return x; } return 0; }\nfunction log() {}",
      },
    ]);
    const generated = worldFromCode(codeGraph, 1);
    expect(generated.layout.unresolved).toEqual([]);
    expect(
      generated.layout.rooms
        .filter((room) => room.cluster === "find.ts::find")
        .map((room) => room.role)
    ).toEqual(["collapsed", "return"]);
  });

  it("keeps a call portal clear of the door to a callee widened by its loop", () => {
    const codeGraph = buildCodeGraph([
      {
        path: "m.ts",
        source: [
          "function f() { use(a([]), b([]), c([])); }",
          "function use(...xs: unknown[]) { return xs; }",
          looping("a"),
          looping("b"),
          looping("c"),
        ].join("\n"),
      },
    ]);
    for (let seed = 1; seed <= 30; seed += 1) {
      expect(
        checkAreas(areasFromCode(codeGraph, seed)),
        `seed ${seed}`
      ).toEqual([]);
    }
  });
});
