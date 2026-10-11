import type { AreaLink } from "@repo/code-graph/area-links";
import type { AreaWorld, Placement } from "@repo/types";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { PoseFeed } from "~/pose-feed";
import { WorldMap } from "~/world-map";
import { playerMarker, worldMapModel } from "~/world-map-model";

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
};

/** Before the first pose of a world with no areas: the origin, north up. */
const NO_POSE: Placement = {
  position: { x: 0, z: 0 },
  facing: { x: 0, z: -1 },
};

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
}: WorldMapOverlayProps) => {
  const model = useMemo(
    () => worldMapModel(world, { errors, labelOf, links }),
    [world, errors, labelOf, links]
  );
  const entry =
    world.areas.find((area) => area.id === world.entry) ?? world.areas[0];
  const start =
    entry === undefined
      ? NO_POSE
      : { position: entry.built.start, facing: entry.built.facing };
  const pose = useSyncExternalStore(feed.subscribe, feed.get) ?? start;
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
          {built}/{total} areas · Tab or Esc closes
        </p>
        <WorldMap
          className="min-h-0 w-full flex-1"
          model={model}
          player={player}
          done={world.pending.length === 0}
        />
      </div>
    </div>
  );
};

export { WorldMapOverlay };
