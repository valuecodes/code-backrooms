import type { Doorway } from "@repo/types";
import { DOOR_HEIGHT } from "@repo/world-generator/config";
import { useEffect, useMemo } from "react";

import { mergeBoxes } from "./merge";
import type { Box } from "./merge";
import { useSurfaces } from "./surfaces";

type DoorFramesProps = {
  readonly doorways: readonly Doorway[];
};

const TRIM = 0.05;
/** How far the frame stands proud of the wall on each side. */
const PROUD = 0.02;
/**
 * How far the frame reaches into the opening. Without it the frame's inner
 * faces are coplanar with the wall ends and lintel underside, and z-fight.
 */
const REVEAL = 0.01;

/** Head and two jambs of a dark wooden frame around one doorway. */
const frameBoxes = (doorway: Doorway): Box[] => {
  const [x, y, z] = doorway.center;
  const alongX = doorway.axis === "x";
  const depth = doorway.depth + PROUD * 2;
  const offset = doorway.width / 2 + TRIM / 2 - REVEAL;
  const headSize = alongX
    ? ([doorway.width + TRIM * 2, TRIM, depth] as const)
    : ([depth, TRIM, doorway.width + TRIM * 2] as const);
  const jambSize = alongX
    ? ([TRIM, DOOR_HEIGHT, depth] as const)
    : ([depth, DOOR_HEIGHT, TRIM] as const);
  const jambY = y + DOOR_HEIGHT / 2;
  return [
    {
      center: [x, y + DOOR_HEIGHT + TRIM / 2 - REVEAL, z],
      size: headSize,
    },
    {
      center: alongX ? [x - offset, jambY, z] : [x, jambY, z - offset],
      size: jambSize,
    },
    {
      center: alongX ? [x + offset, jambY, z] : [x, jambY, z + offset],
      size: jambSize,
    },
  ];
};

/** Every door frame in the world as a single mesh. */
const DoorFrames = ({ doorways }: DoorFramesProps) => {
  const surfaces = useSurfaces();
  const geometry = useMemo(
    () => mergeBoxes(doorways.flatMap(frameBoxes), 1),
    [doorways]
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry === null ? null : (
    <mesh
      geometry={geometry}
      material={surfaces.frame}
      castShadow
      dispose={null}
    />
  );
};

export { DoorFrames };
