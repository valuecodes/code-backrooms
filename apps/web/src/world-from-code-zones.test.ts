import { ENTRANCE_ID } from "@repo/code-graph/ids";
import { buildCodeGraph } from "@repo/parser";
import { checkAreas } from "@repo/world-generator/area-checks";
import { describe, expect, it } from "vitest";

import { areasFromCode, describeRoom } from "./world-from-code";

const json = (value: unknown): string => JSON.stringify(value);

/** An app calling into a library, both workspace packages under a root. */
const workspace = [
  { path: "package.json", source: json({ name: "mono", private: true }) },
  {
    path: "apps/web/package.json",
    source: json({
      name: "web",
      dependencies: { "@repo/lib": "workspace:*" },
    }),
  },
  {
    path: "apps/web/src/main.ts",
    source: [
      'import { run } from "@repo/lib";',
      "export function main() { run(); }",
    ].join("\n"),
  },
  {
    path: "packages/lib/package.json",
    source: json({ name: "@repo/lib", exports: { ".": "./src/lib.ts" } }),
  },
  { path: "packages/lib/src/lib.ts", source: "export function run() {}" },
];

describe("a workspace's world before zone areas", () => {
  const codeGraph = buildCodeGraph(workspace);
  const world = areasFromCode(codeGraph, 1);

  it("names the entrance after the root package", () => {
    expect(describeRoom(codeGraph, ENTRANCE_ID)).toBe("mono");
  });

  it("names the package on portals into another one", () => {
    const app = world.areas.find((area) => area.id === "apps/web/src/main.ts");
    const labels = (app?.graph.portals ?? []).map(({ kind, label }) => [
      kind,
      label,
    ]);
    expect(labels).toContainEqual(["module", "@repo/lib · src/lib.ts"]);
    expect(labels).toContainEqual(["call", "@repo/lib · run"]);
    expect(checkAreas(world)).toEqual([]);
  });
});
