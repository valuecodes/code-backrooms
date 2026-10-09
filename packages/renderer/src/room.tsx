import type { BuiltRoom } from "@repo/types";
import { WALL_HEIGHT } from "@repo/world-generator/config";
import { useEffect, useMemo } from "react";

import { FIXTURE_DROP, fixturePositions } from "./fixtures";
import { frameTint, wallTint } from "./lane-tint";
import { mergeBoxes } from "./merge";
import { useSurfaces } from "./surfaces";
import { tiledPlane } from "./tiled-geometry";

type RoomProps = {
  readonly built: BuiltRoom;
};

const FIXTURE_SIZE = [1.2, 0.08, 0.3] as const;

/**
 * One room (or corridor) in five draw calls: merged walls and lintels, floor,
 * ceiling, merged fixture panels. Door frames are drawn once per shared edge
 * by the World, not here.
 */
const Room = ({ built }: RoomProps) => {
  const surfaces = useSurfaces();
  const { room } = built;
  const [x, y, z] = room.position;
  const top = y + WALL_HEIGHT;
  // Walls take their lane's wash, lintels the full colour of their door's lane.
  const walls = useMemo(
    () =>
      mergeBoxes(
        built.segments.map((segment) => ({
          ...segment,
          color:
            segment.kind === "lintel"
              ? frameTint(segment.lane)
              : wallTint(segment.lane),
        })),
        surfaces.tile.wallpaper
      ),
    [built.segments, surfaces.tile.wallpaper]
  );
  const floor = useMemo(
    () => tiledPlane(room.width, room.depth, surfaces.tile.carpet),
    [room.width, room.depth, surfaces.tile.carpet]
  );
  const ceiling = useMemo(
    () => tiledPlane(room.width, room.depth, surfaces.tile.ceiling),
    [room.width, room.depth, surfaces.tile.ceiling]
  );
  const fixtures = useMemo(
    () =>
      mergeBoxes(
        fixturePositions(room).map((point) => ({
          center: [point.x, point.ceiling - FIXTURE_DROP, point.z] as const,
          size: FIXTURE_SIZE,
        })),
        1
      ),
    [room]
  );
  useEffect(
    () => () => {
      walls?.dispose();
      floor.dispose();
      ceiling.dispose();
      fixtures?.dispose();
    },
    [walls, floor, ceiling, fixtures]
  );
  return (
    <group>
      {walls !== null && (
        <mesh
          geometry={walls}
          material={surfaces.wall}
          castShadow
          receiveShadow
          dispose={null}
        />
      )}
      <mesh
        geometry={floor}
        material={surfaces.floor}
        position={[x, y, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        dispose={null}
      />
      <mesh
        geometry={ceiling}
        material={surfaces.ceiling}
        position={[x, top, z]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
        dispose={null}
      />
      {fixtures !== null && (
        <mesh geometry={fixtures} material={surfaces.fixture} dispose={null} />
      )}
    </group>
  );
};

export { Room };
