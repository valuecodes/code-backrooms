import { describe, expect, it } from "vitest";

import { codeGraphOf, promptOf, worldFromCode } from "./world-from-code";

/** Parses an example or fails the test with the parser's message. */
const graphOf = (name: "external" | "resolution") => {
  const { codeGraph, error } = codeGraphOf(name);
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
  it("never makes an ambiguous or dynamic call a portal or a door", () => {
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

  it("names every call of the resolution example the world cannot follow", () => {
    expect(markerPrompts("resolution").map(([, prompt]) => prompt)).toEqual([
      "closed · shape.render(…) ambiguous: Circle.render() | Square.render(), handlers[…](…) dynamic",
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
