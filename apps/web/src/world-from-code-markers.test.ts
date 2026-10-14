import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { codeGraphOf, promptOf, worldFromCode } from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: "external" | "resolution") => {
  const { codeGraph, error } = codeGraphOf(examples[name]);
  if (codeGraph === null) {
    throw new Error(`${name}: ${error}`);
  }
  return codeGraph;
};

/** Every marker of an example's world at seed 1 with its HUD prompt. */
const markerPrompts = (name: "external" | "resolution") => {
  const codeGraph = graphOf(name);
  const world = worldFromCode(codeGraph, 1);
  return world.built.portals
    .filter(({ portal }) => portal.kind === "marker")
    .map(({ portal }) => [
      portal.from,
      promptOf(codeGraph, [], { kind: "portal", portalId: portal.id }),
    ]);
};

describe("markers", () => {
  it("never follows an ambiguous or dynamic call by a call portal or a door", () => {
    const codeGraph = graphOf("resolution");
    const world = worldFromCode(codeGraph, 1);
    const followed = [
      ...(world.graph.portals ?? [])
        .filter((portal) => portal.kind === "call")
        .map((portal) => portal.to),
      ...world.graph.connections
        .filter((connection) => connection.kind === "call")
        .map((connection) => connection.to),
    ];
    expect(followed.toSorted()).toEqual([
      "resolution.ts::pick",
      "resolution.ts::settle",
    ]);
    expect(world.layout.unplacedPortals).toEqual([]);
  });

  it("offers the ambiguous call at a choice portal instead", () => {
    const codeGraph = graphOf("resolution");
    // Generating validates the graph and the layout, choice portals included.
    const world = worldFromCode(codeGraph, 1);
    const choices = (world.graph.portals ?? []).filter(
      (portal) => portal.kind === "choice"
    );
    expect(choices).toHaveLength(1);
    const [choice] = choices;
    expect(choice?.to).toBe(choice?.from);
    expect(choice?.candidates).toEqual([
      "resolution.ts::Circle.render",
      "resolution.ts::Square.render",
    ]);
    expect(
      world.built.portals.some(({ portal }) => portal.id === choice?.id)
    ).toBe(true);
  });

  it("words the choice portal's prompt with a key per candidate", () => {
    const codeGraph = graphOf("resolution");
    const world = worldFromCode(codeGraph, 1);
    const choice = world.built.portals.find(
      ({ portal }) => portal.kind === "choice"
    );
    const target = {
      kind: "portal",
      portalId: choice?.portal.id ?? "",
    } as const;
    expect(promptOf(codeGraph, [], target)).toBe(
      "choose · shape.render(…)  1 Circle.render()  2 Square.render()"
    );
    expect(
      promptOf(
        codeGraph,
        [],
        target,
        (unit) => unit === "resolution.ts::Square.render"
      )
    ).toBe(
      "choose · shape.render(…)  1 Circle.render()  2 Square.render() (closed)"
    );
  });

  it("names every other call of the resolution example the world cannot follow", () => {
    expect(markerPrompts("resolution").map(([, prompt]) => prompt)).toEqual([
      "closed · handlers[…](…) dynamic",
      "closed · pick(…)(…) dynamic",
      "closed · onDone(…) dynamic",
      "closed · console.log(…) external",
    ]);
  });

  it("closes the external example's runtime calls", () => {
    expect(markerPrompts("external")).toContainEqual([
      expect.stringMatching(/^external\.ts::main@\d+:await$/u),
      "closed · fetch(…) external",
    ]);
  });
});
