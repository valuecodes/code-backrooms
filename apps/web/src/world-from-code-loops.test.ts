import { buildCodeGraph } from "@repo/parser";
import type { RoomData } from "@repo/types";
import { describe, expect, it } from "vitest";

import {
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: "loops") => {
  const { codeGraph, error } = codeGraphOf(name);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return codeGraph;
};

/** The door of `from` that leads to `to`. */
const door = (from: RoomData | undefined, to: RoomData | undefined) =>
  from?.doors.find((candidate) => candidate.targetRoomId === to?.id);

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
});
