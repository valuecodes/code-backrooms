import { describe, expect, it } from "vitest";

import { validateGraph } from "./graph";

describe("validateGraph across areas", () => {
  const rooms = [
    { id: "a", width: 6, depth: 6 },
    { id: "b", width: 6, depth: 6 },
  ];
  const connections = [{ from: "a", to: "b" }];

  it("lets call and module portals lead to units of other areas", () => {
    const hubs = [
      { id: "a", width: 6, depth: 6, hub: true },
      { id: "b", width: 6, depth: 6 },
    ];
    const external = ["x.ts", "x.ts::run"];
    expect(() =>
      validateGraph({
        rooms: hubs,
        connections,
        external,
        portals: [
          { id: "m", kind: "module", from: "a", to: "x.ts" },
          { id: "c", kind: "call", from: "b", to: "x.ts::run" },
        ],
      })
    ).not.toThrow();
    expect(() =>
      validateGraph({
        rooms: hubs,
        connections,
        external,
        portals: [{ id: "r", kind: "return", from: "b", to: "x.ts" }],
      })
    ).toThrow(/unknown room/);
    expect(() =>
      validateGraph({
        rooms: hubs,
        connections,
        external,
        portals: [{ id: "c", kind: "call", from: "b", to: "elsewhere" }],
      })
    ).toThrow(/unknown room/);
    expect(() =>
      validateGraph({ rooms: hubs, connections, external: ["b"] })
    ).toThrow(/room of this graph/);
    expect(() =>
      validateGraph({ rooms: hubs, connections, external: ["x", "x"] })
    ).toThrow(/duplicated/);
  });

  it("rejects a module portal that does not leave a hub", () => {
    expect(() =>
      validateGraph({
        rooms,
        connections,
        external: ["x.ts"],
        portals: [{ id: "m", kind: "module", from: "a", to: "x.ts" }],
      })
    ).toThrow(/must leave a hub/);
  });
});
