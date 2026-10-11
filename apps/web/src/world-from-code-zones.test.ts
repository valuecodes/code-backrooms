import { ENTRANCE_ID, modulePortalId } from "@repo/code-graph/ids";
import { buildCodeGraph } from "@repo/parser";
import { checkAreas } from "@repo/world-generator/area-checks";
import { mergeAreas } from "@repo/world-generator/areas";
import { createNavigator } from "@repo/world-generator/navigation";
import { describe, expect, it } from "vitest";

import {
  areaLabelOf,
  areasFromCode,
  describeRoom,
  promptOf,
} from "./world-from-code";

const json = (value: unknown): string => JSON.stringify(value);

const MAIN = "apps/web/src/main.ts";
const UTIL = "apps/web/src/util.ts";
const LIB = "packages/lib/src/lib.ts";
const WEB_ZONE = "//zone:web";
const LIB_ZONE = "//zone:@repo/lib";

/** The app's sources: `main.ts` calls into the library and its own `util.ts`. */
const appSources = [
  {
    path: MAIN,
    source: [
      'import { run } from "@repo/lib";',
      'import { tidy } from "./util";',
      "export function main() { run(); tidy(); }",
    ].join("\n"),
  },
  { path: UTIL, source: "export function tidy() {}" },
];

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
  ...appSources,
  {
    path: "packages/lib/package.json",
    source: json({ name: "@repo/lib", exports: { ".": "./src/lib.ts" } }),
  },
  { path: LIB, source: "export function run() {}" },
];

const codeGraph = buildCodeGraph(workspace);
const world = areasFromCode(codeGraph, 1);
const merged = mergeAreas(world);

/** The portal of `kind` out of `main.ts`'s area that leads to `to`. */
const portalTo = (kind: string, to: string) => {
  const found = world.areas
    .find((area) => area.id === MAIN)
    ?.built.portals.find(
      ({ portal }) => portal.kind === kind && portal.to === to
    );
  if (found === undefined) {
    throw new Error(`no ${kind} portal to ${to}`);
  }
  return found.portal;
};

const prompt = (portalId: string) =>
  promptOf(codeGraph, [], { kind: "portal", portalId });

describe("a workspace's world of zones", () => {
  it("passes every area check", () => {
    expect(checkAreas(world)).toEqual([]);
  });

  it("names the entrance after the root package, a zone hub after its package", () => {
    expect(describeRoom(codeGraph, ENTRANCE_ID)).toBe("mono");
    expect(describeRoom(codeGraph, WEB_ZONE)).toBe("web");
    expect(describeRoom(codeGraph, LIB_ZONE)).toBe("@repo/lib");
  });

  it("labels areas on the world map by package, a file inside its package", () => {
    expect(areaLabelOf(codeGraph, ENTRANCE_ID)).toBe("mono");
    expect(areaLabelOf(codeGraph, WEB_ZONE)).toBe("web");
    expect(areaLabelOf(codeGraph, LIB_ZONE)).toBe("@repo/lib");
    expect(areaLabelOf(codeGraph, MAIN)).toBe("src/main.ts");
    expect(areaLabelOf(codeGraph, LIB)).toBe("src/lib.ts");
  });

  it("names a file inside its zone in the HUD", () => {
    expect(describeRoom(codeGraph, MAIN)).toBe("web · src/main.ts");
    expect(describeRoom(codeGraph, `${MAIN}::main`)).toBe(
      "web · src/main.ts · main()"
    );
    expect(describeRoom(codeGraph, `${LIB}::run`)).toBe(
      "@repo/lib · src/lib.ts · run()"
    );
  });

  it("names the package on portals into another one, wall and prompt alike", () => {
    const app = world.areas.find((area) => area.id === MAIN);
    const labels = (app?.graph.portals ?? []).map(({ kind, label }) => [
      kind,
      label,
    ]);
    expect(labels).toContainEqual(["module", "@repo/lib · src/lib.ts"]);
    expect(labels).toContainEqual(["call", "@repo/lib · run"]);
    expect(prompt(portalTo("module", LIB).id)).toBe("→ @repo/lib · src/lib.ts");
    expect(prompt(portalTo("call", `${LIB}::run`).id)).toBe(
      "→ @repo/lib · run()"
    );
  });

  it("keeps prompts within a zone and out of the hubs as they were", () => {
    expect(prompt(portalTo("module", UTIL).id)).toBe(`→ ${UTIL}`);
    expect(prompt(portalTo("call", `${UTIL}::tidy`).id)).toBe("→ tidy()");
    expect(prompt(modulePortalId(ENTRANCE_ID, WEB_ZONE))).toBe("→ web");
    expect(prompt(modulePortalId(WEB_ZONE, MAIN))).toBe(`→ ${MAIN}`);
  });

  it("walks the entrance into a zone, calls across and returns", () => {
    const navigator = createNavigator(merged);
    const into = (roomId: string, portalId: string) =>
      navigator.step({ frames: [], roomId }, { type: "portal", portalId })
        .state;
    const zone = into(ENTRANCE_ID, modulePortalId(ENTRANCE_ID, WEB_ZONE));
    expect(zone).toEqual({ frames: [], roomId: WEB_ZONE });
    const module = into(WEB_ZONE, modulePortalId(WEB_ZONE, MAIN));
    expect(module).toEqual({ frames: [], roomId: MAIN });
    const call = portalTo("call", `${LIB}::run`);
    const called = navigator.step(
      { frames: [], roomId: call.from },
      { type: "portal", portalId: call.id }
    ).state;
    expect(called.roomId).toBe(`${LIB}::run`);
    expect(called.frames).toHaveLength(1);
    // Back across the package boundary, into the caller's unit.
    const back = navigator.step(called, { type: "back" }).state;
    expect(back).toEqual({ frames: [], roomId: `${MAIN}::main` });
  });
});

describe("a workspace of one package", () => {
  it("reads exactly as the same files without packages", () => {
    const sources = [
      {
        path: MAIN,
        source: [
          'import { tidy } from "./util";',
          "export function main() { tidy(); }",
        ].join("\n"),
      },
      { path: UTIL, source: "export function tidy() {}" },
    ];
    const single = buildCodeGraph([
      { path: "apps/web/package.json", source: json({ name: "web" }) },
      ...sources,
    ]);
    const plain = buildCodeGraph(sources);
    const singleWorld = mergeAreas(areasFromCode(single, 1));
    const plainWorld = mergeAreas(areasFromCode(plain, 1));
    for (const id of [ENTRANCE_ID, MAIN, `${MAIN}::main`]) {
      expect(describeRoom(single, id)).toBe(describeRoom(plain, id));
    }
    const ids = plainWorld.built.portals.map(({ portal }) => portal.id);
    expect(singleWorld.built.portals.map(({ portal }) => portal.id)).toEqual(
      ids
    );
    for (const portalId of ids) {
      const target = { kind: "portal", portalId } as const;
      expect(promptOf(single, [], target)).toBe(promptOf(plain, [], target));
    }
  });
});
