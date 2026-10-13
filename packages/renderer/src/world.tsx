import { useFrame, useThree } from "@react-three/fiber";
import type { AreaWorld } from "@repo/types";
import { pendingPortals } from "@repo/world-generator/areas";
import { useEffect, useMemo, useRef } from "react";
import { BackSide } from "three";
import type { Mesh } from "three";

import { Area } from "./area";
import { areaFixtures } from "./fixtures";
import { LightPool } from "./lights";
import { createSurfaces, SurfacesContext } from "./surfaces";

type WorldProps = {
  readonly world: AreaWorld;
};

const HAZE = "#4d441f";

/** Past full fog (28 m) and inside the camera's far plane (32 m). */
const HAZE_RADIUS = 30;

/**
 * The haze beyond the fog, drawn as a sphere around the camera rather than
 * as the clear colour: a mesh is tone-mapped like the fogged walls are,
 * whether the renderer or a post-processing pass does the mapping, so the
 * horizon matches the walls at every quality.
 */
const Haze = () => {
  const mesh = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={mesh} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[HAZE_RADIUS, 16, 8]} />
      <meshBasicMaterial
        color={HAZE}
        side={BackSide}
        fog={false}
        depthWrite={false}
      />
    </mesh>
  );
};

/** Scene-wide setup: haze, fog, ambient light, shared materials, areas. */
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
      <Haze />
      <ambientLight color="#ffe9b3" intensity={0.5} />
      {areas.map((area) => (
        <Area key={area.id} area={area} pending={pendingPortals(world, area)} />
      ))}
      <LightPool fixtures={fixtures} />
    </SurfacesContext>
  );
};

export { World };
