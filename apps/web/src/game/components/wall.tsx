import { useEffect, useMemo } from "react";

import { useSurfaces } from "~/game/surfaces";
import { tiledBox } from "~/game/tiled-geometry";
import type { WallSegment } from "~/game/types";

type WallProps = {
  readonly segment: WallSegment;
};

/** One axis-aligned box of wallpapered wall. */
const Wall = ({ segment }: WallProps) => {
  const surfaces = useSurfaces();
  const geometry = useMemo(
    () => tiledBox(segment.size, surfaces.tile.wallpaper),
    [segment.size, surfaces.tile.wallpaper]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={surfaces.wall}
      position={segment.center}
      castShadow
      receiveShadow
      dispose={null}
    />
  );
};

export { Wall };
