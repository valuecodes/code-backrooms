import { areaLinksOf } from "@repo/code-graph/area-links";
import { codeAreaStore } from "@repo/code-graph/module-areas";
import { buildCodeGraph } from "@repo/parser";
import type { AreaWorld } from "@repo/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { fitViewBox } from "./view-box";
import type { ViewBox } from "./view-box";
import { areaLabelOf, codeGraphOf } from "./world-from-code";
import { WorldMap } from "./world-map";
import { playerMarker, worldMapModel } from "./world-map-model";

const repo = () => {
  const { codeGraph, error } = codeGraphOf(examples.repo);
  if (codeGraph === null) {
    throw new Error(`repo: ${error}`);
  }
  return codeGraph;
};

const json = (value: unknown): string => JSON.stringify(value);

/** An app calling into a library, both workspace packages. */
const workspace = () =>
  buildCodeGraph([
    { path: "package.json", source: json({ name: "mono", private: true }) },
    {
      path: "apps/web/package.json",
      source: json({ name: "web", dependencies: { "@repo/lib": "*" } }),
    },
    {
      path: "apps/web/src/main.ts",
      source:
        'import { run } from "@repo/lib";\nexport function main() { run(); }',
    },
    {
      path: "packages/lib/package.json",
      source: json({ name: "@repo/lib", exports: { ".": "./src/lib.ts" } }),
    },
    { path: "packages/lib/src/lib.ts", source: "export function run() {}" },
  ]);

/** How often `needle` occurs in `markup`. */
const countOf = (markup: string, needle: string): number =>
  markup.split(needle).length - 1;

const render = (
  world: AreaWorld,
  options: Parameters<typeof worldMapModel>[1] = {}
): string => {
  const model = worldMapModel(world, options);
  const player =
    options.player === undefined || options.player === null
      ? null
      : playerMarker(world, options.player);
  return renderToStaticMarkup(
    <WorldMap model={model} player={player} done={world.pending.length === 0} />
  );
};

describe("WorldMap", () => {
  it("draws one svg with a ghost per pending area and a line per link, then is done", () => {
    const graph = repo();
    const store = codeAreaStore(graph, 1);
    const links = areaLinksOf(graph);
    const labelOf = (id: string) => areaLabelOf(graph, id);
    const start = store.snapshot().world;
    const markup = render(start, { links, labelOf });
    expect(countOf(markup, "<svg")).toBe(1);
    expect(markup).toContain('data-state="generating"');
    expect(countOf(markup, 'data-area-state="pending"')).toBe(
      start.pending.length
    );
    expect(countOf(markup, 'data-area-state="generated"')).toBe(1);
    expect(countOf(markup, "<line")).toBe(
      worldMapModel(start, { links }).links.length
    );
    expect(markup).toContain(">src/index.ts</text>");
    expect(markup).not.toContain("<polygon");

    store.ensureAll();
    const done = render(store.snapshot().world, { links, labelOf });
    expect(done).toContain('data-state="done"');
    expect(done).not.toContain('data-area-state="pending"');
  });

  it("draws a failed area red with its message", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const [failed, ...pending] = world.pending;
    if (failed === undefined) {
      throw new Error("no pending area");
    }
    const markup = render(
      { ...world, pending, failed: [failed] },
      { errors: new Map([[failed, "no room for the hub"]]) }
    );
    expect(countOf(markup, 'data-area-state="failed"')).toBe(1);
    // On the area's group, so hovering its label shows the message too.
    expect(markup).toContain(
      `data-area-state="failed"><title>no room for the hub</title>`
    );
  });

  it("names each zone on its band and draws the player", () => {
    const store = codeAreaStore(workspace(), 1);
    store.ensureAll();
    const world = store.snapshot().world;
    const entry = world.areas[0];
    if (entry === undefined) {
      throw new Error("no entrance");
    }
    const markup = render(world, {
      player: { position: entry.built.start, facing: entry.built.facing },
    });
    for (const zone of world.zones) {
      expect(markup).toContain(`data-zone="${zone.id}"`);
      expect(markup).toContain(`>${zone.name} 1/1</text>`);
    }
    expect(world.zones).toHaveLength(2);
    expect(countOf(markup, "<polygon")).toBe(1);
  });

  it("shows the given view, hiding rooms and labels zoomed out", () => {
    const store = codeAreaStore(workspace(), 1);
    store.ensureAll();
    const world = store.snapshot().world;
    const model = worldMapModel(world);
    const fit = fitViewBox(model.bounds);
    const markupAt = (viewBox?: ViewBox) =>
      renderToStaticMarkup(
        <WorldMap model={model} player={null} done viewBox={viewBox} />
      );

    const whole = markupAt();
    expect(whole).toContain(
      `viewBox="${fit.x} ${fit.y} ${fit.width} ${fit.height}"`
    );
    expect(markupAt(fit)).toBe(whole);

    const near = markupAt({ x: 1, y: 2, width: 300, height: 100 });
    expect(near).toContain('viewBox="1 2 300 100"');
    expect(near).toContain('data-detail="full"');
    expect(markupAt({ x: 0, y: 0, width: 900, height: 300 })).toContain(
      'data-detail="overview"'
    );

    // Every room and area label can hide; zone names never do.
    const rooms = world.areas.reduce(
      (total, area) => total + area.layout.rooms.length,
      0
    );
    expect(countOf(near, 'class="map-detail"')).toBe(
      rooms + model.areas.length
    );
    expect(near).not.toMatch(/<text class="map-detail" data-zone-name/);
  });

  it("draws the rooms of the function the player is in brighter, at any zoom", () => {
    const store = codeAreaStore(workspace(), 1);
    store.ensureAll();
    const model = worldMapModel(store.snapshot().world);
    const unit = "apps/web/src/main.ts::main";
    const rooms = model.areas.flatMap((area) =>
      area.rooms.filter((room) => room.unit === unit)
    );
    expect(rooms.length).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(
      <WorldMap model={model} player={null} activeUnit={unit} done />
    );
    const group = new RegExp(`<g data-active-unit="${unit}">(.*?)</g>`).exec(
      markup
    )?.[1];
    expect(countOf(group ?? "", "<rect")).toBe(rooms.length);
    // Not detail: zoomed out, the rooms hide but these stay.
    expect(group).not.toContain("map-detail");
    expect(
      renderToStaticMarkup(<WorldMap model={model} player={null} done />)
    ).not.toContain("data-active-unit");
  });

  it("draws zone names larger as the view widens", () => {
    const store = codeAreaStore(workspace(), 1);
    store.ensureAll();
    const model = worldMapModel(store.snapshot().world);
    const zone = model.zones[0];
    if (zone === undefined) {
      throw new Error("no zone");
    }
    const sizeAt = (width: number): number => {
      const markup = renderToStaticMarkup(
        <WorldMap
          model={model}
          player={null}
          done
          viewBox={{ x: 0, y: 0, width, height: width / 3 }}
        />
      );
      const match = new RegExp(
        `data-zone-name="${zone.id}"[^>]*font-size="([\\d.]+)"`
      ).exec(markup);
      return Number(match?.[1]);
    };
    expect(sizeAt(1800)).toBeGreaterThan(sizeAt(100));
  });

  it("gives each map its own clip paths", () => {
    const world = codeAreaStore(repo(), 1).snapshot().world;
    const model = worldMapModel(world);
    const markup = renderToStaticMarkup(
      <>
        <WorldMap model={model} player={null} done={false} />
        <WorldMap model={model} player={null} done={false} />
      </>
    );
    const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(
      ([, id]) => id
    );
    expect(ids).toHaveLength(model.areas.length * 2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
