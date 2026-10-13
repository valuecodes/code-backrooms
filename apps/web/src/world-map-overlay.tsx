import type { AreaLink } from "@repo/code-graph/area-links";
import type { AreaWorld } from "@repo/types";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { PoseFeed } from "~/pose-feed";
import { useViewBox } from "~/use-view-box";
import { fitViewBox } from "~/view-box";
import { WorldMap } from "~/world-map";
import { playerMarker, startPlacement, worldMapModel } from "~/world-map-model";

type WorldMapOverlayProps = {
  readonly world: AreaWorld;
  /** The message of every area that could not be generated, by area id. */
  readonly errors: ReadonlyMap<string, string>;
  /** What an area is called on the map; stable, or the map is rebuilt. */
  readonly labelOf: (areaId: string) => string;
  /** The links between areas; stable, or the map is rebuilt. */
  readonly links: readonly AreaLink[];
  /** Where the player is; only the marker follows it. */
  readonly feed: PoseFeed;
  /** The function (or hub) the player is in, drawn brighter. */
  readonly activeUnit: string | null;
  /** Walking: the locked pointer sends the map no wheel or drag. */
  readonly locked: boolean;
};

/** How the map moves, once the pointer is free. */
const ZOOM_HINT = "wheel zooms · drag pans · double-click resets";

const keepClick = (event: MouseEvent) => {
  event.stopPropagation();
};

/**
 * The Tab overlay: the whole world drawn over the scene, the player's
 * marker following them while they walk.
 */
const WorldMapOverlay = ({
  world,
  errors,
  labelOf,
  links,
  feed,
  activeUnit,
  locked,
}: WorldMapOverlayProps) => {
  const model = useMemo(
    () => worldMapModel(world, { errors, labelOf, links }),
    [world, errors, labelOf, links]
  );
  const fit = useMemo(() => fitViewBox(model.bounds), [model]);
  const view = useViewBox(fit);
  const pose =
    useSyncExternalStore(feed.subscribe, feed.get) ?? startPlacement(world);
  const player = useMemo(() => playerMarker(world, pose), [world, pose]);
  // PointerLockControls locks the pointer on any click that reaches the
  // document: a click on the map must stop short of it.
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = backdrop.current;
    element?.addEventListener("click", keepClick);
    return () => element?.removeEventListener("click", keepClick);
  }, []);
  const built = world.areas.length;
  const total = built + world.pending.length + world.failed.length;

  return (
    <div ref={backdrop} className="pointer-events-auto absolute inset-0 p-4">
      <div className="flex h-full flex-col gap-2 rounded bg-black/80 p-3">
        <p className="font-mono text-xs text-amber-100/70">
          {built}/{total} areas · Tab or Esc closes ·{" "}
          {locked ? "Esc frees the pointer to zoom" : ZOOM_HINT}
        </p>
        <WorldMap
          className="min-h-0 w-full flex-1 cursor-grab touch-none"
          viewBox={view.viewBox}
          svgRef={view.ref}
          model={model}
          player={player}
          activeUnit={activeUnit}
          done={world.pending.length === 0}
        />
      </div>
    </div>
  );
};

export { WorldMapOverlay };
