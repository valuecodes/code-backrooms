import { useEffect, useMemo } from "react";

import { useSurfaces } from "~/game/surfaces";
import { tiledPlane } from "~/game/tiled-geometry";
import type { RoomData } from "~/game/types";

type FloorProps = {
  readonly room: RoomData;
};

const Floor = ({ room }: FloorProps) => {
  const surfaces = useSurfaces();
  const geometry = useMemo(
    () => tiledPlane(room.width, room.depth, surfaces.tile.carpet),
    [room.width, room.depth, surfaces.tile.carpet]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={surfaces.floor}
      position={room.position}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      dispose={null}
    />
  );
};

export { Floor };
