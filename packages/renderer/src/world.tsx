import { useThree } from "@react-three/fiber";
import type { AreaWorld } from "@repo/types";
import { pendingPortals } from "@repo/world-generator/areas";
import { useEffect, useMemo } from "react";

import { Area } from "./area";
import { areaFixtures } from "./fixtures";
import { LightPool } from "./lights";
import { createSurfaces, SurfacesContext } from "./surfaces";

type WorldProps = {
  readonly world: AreaWorld;
};

const HAZE = "#4d441f";

/** Scene-wide setup: background, fog, ambient light, shared materials, areas. */
const World = ({ world }: WorldProps) => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const surfaces = useMemo(
    () => createSurfaces(gl.capabilities.getMaxAnisotropy()),
    [gl]
  );
  useEffect(() => () => surfaces.dispose(), [surfaces]);
  const { areas } = world;
  const fixtures = useMemo(() => areas.flatMap(areaFixtures), [areas]);
  // Compile every shader up front: with a fixed light count there is one
  // variant per material, so this is a one-off. Run again when an area
  // joins, which may bring the first mesh of a material; the programs
  // compiled already are a cache hit.
  useEffect(() => {
    gl.compile(scene, camera);
  }, [gl, scene, camera, areas]);
  return (
    <SurfacesContext value={surfaces}>
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 5, 28]} />
      <ambientLight color="#ffe9b3" intensity={0.5} />
      {areas.map((area) => (
        <Area key={area.id} area={area} pending={pendingPortals(world, area)} />
      ))}
      <LightPool fixtures={fixtures} />
    </SurfacesContext>
  );
};

export { World };
