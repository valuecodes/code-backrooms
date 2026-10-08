import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { Vector3 } from "three";

import { moveWithCollisions } from "~/game/collision";
import type { Point } from "~/game/collision";
import {
  EYE_HEIGHT,
  MAX_FRAME_SECONDS,
  MAX_STEP_DISTANCE,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
} from "~/game/config";
import { useMovementKeys } from "~/game/controls";
import type { BuiltWorld } from "~/game/types";

type PlayerProps = {
  readonly world: BuiltWorld;
  /** False while the pointer is not locked: input is ignored and motion stops. */
  readonly enabled: boolean;
};

const UP = new Vector3(0, 1, 0);
/** Higher is snappier; the velocity closes 1 - e^-SMOOTHING of the gap per second. */
const SMOOTHING = 10;

/** First-person movement, driven from the render loop without React state. */
const Player = ({ world, enabled }: PlayerProps) => {
  const camera = useThree((state) => state.camera);
  const keys = useMovementKeys();
  const position = useRef<Point>(world.start);
  const velocity = useRef(new Vector3());
  const scratch = useRef({
    forward: new Vector3(),
    right: new Vector3(),
    target: new Vector3(),
  });

  useLayoutEffect(() => {
    position.current = world.start;
    camera.position.set(world.start.x, EYE_HEIGHT, world.start.z);
    camera.lookAt(world.start.x + 1, EYE_HEIGHT, world.start.z);
  }, [camera, world]);

  useFrame((_, delta) => {
    // A longer frame is a pause (tab switch, pointer-lock dialog), not motion:
    // simulate at most MAX_FRAME_SECONDS of it. Substepping keeps even that
    // step collision-safe.
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const { forward, right, target } = scratch.current;
    target.set(0, 0, 0);
    if (enabled) {
      const held = keys.current;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0) {
        forward.normalize();
      }
      right.crossVectors(forward, UP);
      const ahead = (held.forward ? 1 : 0) - (held.backward ? 1 : 0);
      const side = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      target.addScaledVector(forward, ahead).addScaledVector(right, side);
      if (target.lengthSq() > 1) {
        target.normalize();
      }
      target.multiplyScalar(held.sprint ? SPRINT_SPEED : WALK_SPEED);
      velocity.current.lerp(target, 1 - Math.exp(-SMOOTHING * dt));
    } else {
      velocity.current.set(0, 0, 0);
    }
    const { x, z } = velocity.current;
    const next = moveWithCollisions(
      position.current,
      { x: x * dt, z: z * dt },
      PLAYER_RADIUS,
      world.colliders,
      MAX_STEP_DISTANCE
    );
    position.current = next;
    camera.position.set(next.x, EYE_HEIGHT, next.z);
  });

  return null;
};

export { Player };
