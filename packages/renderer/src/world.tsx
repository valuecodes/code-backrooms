import { useFrame, useThree } from "@react-three/fiber";
import type { AreaWorld } from "@repo/types";
import { pendingPortals } from "@repo/world-generator/areas";
import { useEffect, useMemo, useRef } from "react";
import { BackSide } from "three";
import type { Mesh } from "three";

import { Area } from "./area";
import { createAreaLighting } from "./area-lighting";
import { createBakeQueue, createBakeWorker } from "./bake-client";
import { areaFixtures } from "./fixtures";
import { LightPool } from "./lights";
import { createSurfaces, SurfacesContext } from "./surfaces";

type WorldProps = {
  readonly world: AreaWorld;
};

const HAZE = "#4d441f";

/** The fill light: warm from the ceiling, mustard off the walls below. */
const SKY = "#ffe9b3";
const GROUND = "#8a7a3a";
const FILL_INTENSITY = 0.25;

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

/**
 * Scene-wide setup: haze, fog, a faint fill light, shared materials, each
 * area's baked lighting, the areas.
 */
const World = ({ world }: WorldProps) => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const surfaces = useMemo(
    () => createSurfaces(gl.capabilities.getMaxAnisotropy()),
    [gl]
  );
  useEffect(() => () => surfaces.dispose(), [surfaces]);
  const lighting = useMemo(
    () => createAreaLighting(surfaces, createBakeQueue(createBakeWorker)),
    [surfaces]
  );
  const { areas } = world;
  // Bake every area that joined; let go of the ones that left.
  useEffect(() => {
    lighting.sync(areas);
  }, [lighting, areas]);
  useEffect(() => () => lighting.dispose(), [lighting]);
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
      {/* Walls, floor and ceiling take their fill from the lightmap; this
          lights what is not lightmapped (frames, fixtures, portals). */}
      <hemisphereLight args={[SKY, GROUND, FILL_INTENSITY]} />
      {areas.map((area) => (
        <Area
          key={area.id}
          area={area}
          pending={pendingPortals(world, area)}
          lighting={lighting.get(area)}
        />
      ))}
      <LightPool fixtures={fixtures} />
    </SurfacesContext>
  );
};

export { World };
