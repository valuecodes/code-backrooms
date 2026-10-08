import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import { Room } from "~/game/components/room";
import { createSurfaces, SurfacesContext } from "~/game/surfaces";
import type { BuiltWorld } from "~/game/types";

type WorldProps = {
  readonly world: BuiltWorld;
};

const HAZE = "#4d441f";

/** Scene-wide setup: background, fog, ambient light, shared materials, rooms. */
const World = ({ world }: WorldProps) => {
  const gl = useThree((state) => state.gl);
  const surfaces = useMemo(
    () => createSurfaces(gl.capabilities.getMaxAnisotropy()),
    [gl]
  );
  useEffect(() => () => surfaces.dispose(), [surfaces]);
  return (
    <SurfacesContext value={surfaces}>
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 5, 28]} />
      <ambientLight color="#ffe9b3" intensity={0.35} />
      {world.rooms.map((built) => (
        <Room key={built.room.id} built={built} />
      ))}
    </SurfacesContext>
  );
};

export { World };
