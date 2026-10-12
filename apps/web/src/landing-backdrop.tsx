import { Canvas, useFrame } from "@react-three/fiber";
import { World } from "@repo/renderer/world";
import type { Placement } from "@repo/types";
import { useMemo } from "react";

import { driftPose } from "~/backdrop";
import { backdropWorld } from "~/backdrop-world";
import { startPlacement } from "~/world-map-model";

// Loaded lazily by the landing page: the demo world, seen through a camera
// that drifts on its own. No player, no pointer lock, no input.

/** The player's eye height, so the backdrop looks like walking. */
const EYE = 1.7;

const DriftCamera = ({ start }: { readonly start: Placement }) => {
  useFrame(({ camera, clock }) => {
    const { position, facing } = driftPose(start, clock.elapsedTime);
    camera.position.set(position.x, EYE, position.z);
    camera.lookAt(facing.x, EYE, facing.z);
  });
  return null;
};

/** The demo world filling its parent, or nothing when it cannot be built. */
const LandingBackdrop = () => {
  const world = useMemo(() => backdropWorld(), []);
  const start = useMemo(
    () => (world === null ? null : startPlacement(world)),
    [world]
  );
  if (world === null || start === null) {
    return null;
  }
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.25]}
      camera={{ fov: 75, near: 0.05, far: 32 }}
      gl={{ antialias: true }}
      // As in the world view: the scene is static, so the light pool asks
      // for a shadow render only when its shadow light moves.
      onCreated={({ gl }) => {
        gl.shadowMap.autoUpdate = false;
        gl.shadowMap.needsUpdate = true;
      }}
    >
      <World world={world} />
      <DriftCamera start={start} />
    </Canvas>
  );
};

export { LandingBackdrop };
