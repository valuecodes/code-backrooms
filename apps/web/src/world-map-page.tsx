import { useCallback, useMemo, useRef } from "react";

import { mapHeader, svgFileName } from "~/map-page-text";
import { requestFromParams } from "~/source-request";
import type { WorldOptions } from "~/use-area-world";
import { useAreaWorld } from "~/use-area-world";
import { useGenerateAll } from "~/use-generate-all";
import { useViewBox } from "~/use-view-box";
import { fitViewBox } from "~/view-box";
import type { ViewBox } from "~/view-box";
import { WorldLoading } from "~/world-loading";
import { WorldMap } from "~/world-map";
import { playerMarker, startPlacement, worldMapModel } from "~/world-map-model";
import { initial, useWorldSetup } from "~/world-setup";
import type { WorldSetup } from "~/world-setup";

// `?view=map`: the whole world as one SVG, generated an area at a time, with
// no WebGL. Headless tools wait for `[data-state="done"]` (the map) or
// `[data-state="failed"]` (no world to draw, an example that failed to load
// included).

/** What the page shows the world of: the example, the preset, or random. */
const worldName = initial.code ?? initial.preset ?? "random";

/** The map page is URL-driven only: examples, presets and random worlds. */
const request = requestFromParams(initial);

/** The view before there is a world to fit. */
const NO_VIEW: ViewBox = { x: 0, y: 0, width: 1, height: 1 };

/** Saves `markup` as a file, through a blob URL the page's CSP allows. */
const downloadSvg = (markup: string, fileName: string): void => {
  const url = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked on the next task: some browsers drop a download whose URL is
  // revoked in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const MapPageBody = ({ setup }: { readonly setup: WorldSetup }) => {
  const { areaLinks, labelOfArea, startSeed, worldOptions } = setup;
  // Never up front: `?eager=1` would generate every area before the first
  // paint, and the page is here to show them arrive.
  const mapOptions: WorldOptions = useMemo(
    () => ({ ...worldOptions, eager: false }),
    [worldOptions]
  );
  const generated = useAreaWorld(startSeed, mapOptions);
  const { world, errors } = generated;
  useGenerateAll(generated.ensureNext, true);
  const model = useMemo(
    () =>
      world === null
        ? null
        : worldMapModel(world, {
            errors,
            labelOf: labelOfArea,
            links: areaLinks,
          }),
    [world, errors, labelOfArea, areaLinks]
  );
  const player = useMemo(
    () => (world === null ? null : playerMarker(world, startPlacement(world))),
    [world]
  );
  const done = world !== null && world.pending.length === 0;
  const fit = useMemo(
    () => (model === null ? NO_VIEW : fitViewBox(model.bounds)),
    [model]
  );
  const view = useViewBox(fit);
  const { atFit } = view;
  const container = useRef<HTMLDivElement>(null);
  // The whole world whatever the zoom, so the file matches every other run.
  // It carries no `globals.css`, so nothing in it hides rooms or labels.
  const onDownload = useCallback(() => {
    const markup = atFit(() => {
      const svg = container.current?.querySelector("svg");
      return svg === null || svg === undefined
        ? null
        : new XMLSerializer().serializeToString(svg);
    });
    if (markup !== null) {
      downloadSvg(markup, svgFileName(worldName, startSeed));
    }
  }, [atFit, startSeed]);

  return (
    <div className="flex h-dvh w-screen flex-col gap-2 bg-black p-4 font-mono text-xs text-amber-100/70">
      <div className="flex items-center gap-4">
        <p>
          {world === null
            ? `${worldName} · seed ${startSeed}`
            : mapHeader({ name: worldName, seed: startSeed, world })}
        </p>
        <button
          type="button"
          className="rounded border border-amber-100/30 px-2 py-0.5 hover:bg-amber-100/10 disabled:opacity-40"
          disabled={!done}
          onClick={onDownload}
        >
          Download SVG
        </button>
        <p>wheel zooms · drag pans · double-click resets</p>
      </div>
      {/* Nothing to draw: the end state headless tools wait for instead. */}
      {generated.error !== null && (
        <p className="text-red-400" data-state="failed">
          {generated.error}
        </p>
      )}
      {errors.size > 0 && (
        <ul className="text-red-400">
          {[...errors].map(([area, message]) => (
            <li key={area}>
              {area}: {message}
            </li>
          ))}
        </ul>
      )}
      <div ref={container} className="flex min-h-0 flex-1">
        {model !== null && (
          <WorldMap
            className="min-h-0 w-full flex-1 cursor-grab touch-none"
            viewBox={view.viewBox}
            svgRef={view.ref}
            model={model}
            player={player}
            done={done}
          />
        )}
      </div>
    </div>
  );
};

/** The map page, once the URL's example has its files (`?code=self` waits). */
const WorldMapPage = () => {
  const setup = useWorldSetup(request);
  return setup === null ? (
    <WorldLoading label={initial.code} phase="loading" />
  ) : (
    <MapPageBody setup={setup} />
  );
};

export { WorldMapPage };
