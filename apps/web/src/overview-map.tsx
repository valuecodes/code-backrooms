import { laneColour } from "@repo/renderer/lane-tint";
import type { BuiltWorld, PortalKind } from "@repo/types";
import { useMemo, useSyncExternalStore } from "react";

import { mapModel } from "~/map-model";
import type { MapPortal, MapRoom } from "~/map-model";
import type { PoseFeed } from "~/pose-feed";

type OverviewMapProps = {
  readonly world: BuiltWorld;
  readonly visited: ReadonlySet<string>;
  /** The room the player stands in, or null between rooms. */
  readonly current: string | null;
  /** Where the player is; only the map re-renders when it moves. */
  readonly feed: PoseFeed;
};

/** Size on screen in pixels; at SCALE px per metre it shows 40 m across. */
const MAP_SIZE = 240;
const SCALE = 6;
const SPAN = MAP_SIZE / SCALE;
const DOOR_SIZE = 0.8;
const PORTAL_HALF = 0.6;
/** No lane: the amber of the HUD text. */
const PLAIN = "#fde68a";

const PORTAL_COLOURS: Record<PortalKind, string> = {
  call: "#f59e0b",
  return: "#fef3c7",
  jump: "#9ca3af",
};

const roomFill = (room: MapRoom): string => {
  if (!room.visited) {
    return "none";
  }
  return room.lane === null ? PLAIN : laneColour(room.lane);
};

/** A short bar on the wall, a little inside the room, along the frame. */
const portalBar = ({ point, normal }: MapPortal) => {
  const x = point.x + normal.x * 0.2;
  const z = point.z + normal.z * 0.2;
  return {
    x1: x - normal.z * PORTAL_HALF,
    y1: z + normal.x * PORTAL_HALF,
    x2: x + normal.z * PORTAL_HALF,
    y2: z - normal.x * PORTAL_HALF,
  };
};

/**
 * The rooms walked so far and the rooms seen through their doors, drawn from
 * above round the player, north up. Screen y is world z, so north (-Z) is
 * already at the top.
 */
const OverviewMap = ({ world, visited, current, feed }: OverviewMapProps) => {
  const pose = useSyncExternalStore(feed.subscribe, feed.get) ?? {
    position: world.start,
    facing: world.facing,
  };

  const model = useMemo(
    () => mapModel(world, visited, current),
    [world, visited, current]
  );
  const { x, z } = pose.position;
  const heading =
    (Math.atan2(pose.facing.z - z, pose.facing.x - x) * 180) / Math.PI;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-3 left-4 bg-black/55"
      width={MAP_SIZE}
      height={MAP_SIZE}
      viewBox={`${x - SPAN / 2} ${z - SPAN / 2} ${SPAN} ${SPAN}`}
    >
      {model.rooms.map((room) => (
        <rect
          key={room.id}
          x={room.rect.minX}
          y={room.rect.minZ}
          width={room.rect.maxX - room.rect.minX}
          height={room.rect.maxZ - room.rect.minZ}
          fill={roomFill(room)}
          fillOpacity={room.kind === "corridor" ? 0.2 : 0.35}
          stroke={PLAIN}
          strokeOpacity={room.current ? 0.9 : 0.35}
          strokeWidth={room.current ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {model.doors.map(({ point, lane }) => (
        <rect
          key={`${point.x},${point.z}`}
          x={point.x - DOOR_SIZE / 2}
          y={point.z - DOOR_SIZE / 2}
          width={DOOR_SIZE}
          height={DOOR_SIZE}
          fill={lane === null ? PLAIN : laneColour(lane)}
          fillOpacity={0.8}
        />
      ))}
      {model.portals.map((portal) => (
        <line
          key={portal.id}
          {...portalBar(portal)}
          stroke={PORTAL_COLOURS[portal.kind]}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polygon
        points="0.9,0 -0.5,0.55 -0.5,-0.55"
        transform={`translate(${x} ${z}) rotate(${heading})`}
        fill="#fffbeb"
      />
    </svg>
  );
};

export { OverviewMap };
