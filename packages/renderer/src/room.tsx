import type { BuiltRoom } from "@repo/types";
import { WALL_HEIGHT } from "@repo/world-generator/config";
import { useEffect, useMemo } from "react";

import type { AreaLighting } from "./area-lighting";
import { fixturePositions } from "./fixtures";
import type { LightmapFace } from "./lightmap-layout";
import { writeLightmapUv } from "./lightmap-layout";
import { mergeBoxes } from "./merge";
import { useSurfaces } from "./surfaces";
import { tiledPlane } from "./tiled-geometry";
import { diffuserBox, housingBoxes } from "./troffer";
import { segmentColour } from "./wall-colour";

type RoomProps = {
  readonly built: BuiltRoom;
  /** Its area's lightmapped materials and layout. */
  readonly lighting: AreaLighting;
  /** Its faces in the area's lightmap: floor, ceiling, then its walls. */
  readonly faces: readonly LightmapFace[];
};

/** BoxGeometry and PlaneGeometry both give each face four vertices. */
const PER_FACE = 4;

/**
 * One room (or corridor) in six draw calls: merged walls and lintels, floor,
 * ceiling, merged troffer housings and diffusers. Door frames are drawn once
 * per shared edge by the World, not here. Walls, floor and ceiling are built
 * in world space and carry `uv1` into the area's lightmap.
 */
const Room = ({ built, lighting, faces }: RoomProps) => {
  const surfaces = useSurfaces();
  const { room } = built;
  const [x, y, z] = room.position;
  const top = y + WALL_HEIGHT;
  const { layout } = lighting;
  const walls = useMemo(() => {
    const merged = mergeBoxes(
      built.segments.map((segment) => ({
        ...segment,
        color: segmentColour(segment, built.room.id),
      })),
      surfaces.tile.wallpaper
    );
    if (merged !== null) {
      writeLightmapUv(merged, faces.slice(2), layout, PER_FACE);
    }
    return merged;
  }, [built.room.id, built.segments, surfaces.tile.wallpaper, faces, layout]);
  const floor = useMemo(() => {
    const plane = tiledPlane(room.width, room.depth, surfaces.tile.carpet)
      .rotateX(-Math.PI / 2)
      .translate(x, y, z);
    writeLightmapUv(plane, faces.slice(0, 1), layout, PER_FACE);
    return plane;
  }, [room.width, room.depth, surfaces.tile.carpet, x, y, z, faces, layout]);
  const ceiling = useMemo(() => {
    const plane = tiledPlane(room.width, room.depth, surfaces.tile.ceiling)
      .rotateX(Math.PI / 2)
      .translate(x, top, z);
    writeLightmapUv(plane, faces.slice(1, 2), layout, PER_FACE);
    return plane;
  }, [room.width, room.depth, surfaces.tile.ceiling, x, top, z, faces, layout]);
  const troffers = useMemo(() => {
    const points = fixturePositions(room);
    return {
      housings: mergeBoxes(points.flatMap(housingBoxes), 1),
      diffusers: mergeBoxes(points.map(diffuserBox), 1),
    };
  }, [room]);
  useEffect(
    () => () => {
      walls?.dispose();
      floor.dispose();
      ceiling.dispose();
      troffers.housings?.dispose();
      troffers.diffusers?.dispose();
    },
    [walls, floor, ceiling, troffers]
  );
  return (
    <group>
      {walls !== null && (
        <mesh
          geometry={walls}
          material={lighting.wall}
          castShadow
          receiveShadow
          dispose={null}
        />
      )}
      <mesh
        geometry={floor}
        material={lighting.floor}
        receiveShadow
        dispose={null}
      />
      <mesh
        geometry={ceiling}
        material={lighting.ceiling}
        receiveShadow
        dispose={null}
      />
      {troffers.housings !== null && (
        <mesh
          geometry={troffers.housings}
          material={surfaces.troffer}
          dispose={null}
        />
      )}
      {troffers.diffusers !== null && (
        <mesh
          geometry={troffers.diffusers}
          material={surfaces.fixture}
          dispose={null}
        />
      )}
    </group>
  );
};

export { Room };
