import { useThree } from "@react-three/fiber";
import type { BuiltWorld } from "@repo/types";
import { useEffect, useMemo } from "react";

import { DoorFrames } from "./door-frames";
import { fixturePositions } from "./fixtures";
import { LightPool } from "./lights";
import { Room } from "./room";
import { createSurfaces, SurfacesContext } from "./surfaces";

type WorldProps = {
  readonly world: BuiltWorld;
};

const HAZE = "#4d441f";

/** Scene-wide setup: background, fog, ambient light, shared materials, rooms. */
const World = ({ world }: WorldProps) => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const surfaces = useMemo(
    () => createSurfaces(gl.capabilities.getMaxAnisotropy()),
    [gl]
  );
  useEffect(() => () => surfaces.dispose(), [surfaces]);
  const fixtures = useMemo(
    () => world.rooms.flatMap((built) => fixturePositions(built.room)),
    [world]
  );
  // Compile every shader up front: with a fixed light count there is exactly
  // one variant per material, so this is a one-off and never stalls a frame.
  useEffect(() => {
    gl.compile(scene, camera);
  }, [gl, scene, camera, world]);
  return (
    <SurfacesContext value={surfaces}>
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 5, 28]} />
      <ambientLight color="#ffe9b3" intensity={0.5} />
      {world.rooms.map((built) => (
        <Room key={built.room.id} built={built} />
      ))}
      <DoorFrames doorways={world.doorways} />
      <LightPool fixtures={fixtures} />
    </SurfacesContext>
  );
};

export { World };
