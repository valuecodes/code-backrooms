import { useFrame, useThree } from "@react-three/fiber";
import type { BuiltWorld, Placement, Point } from "@repo/types";
import { moveWithCollisions } from "@repo/world-generator/collision";
import {
  inAnyTrigger,
  nearestTarget,
  portalToEnter,
} from "@repo/world-generator/interaction";
import type { Target } from "@repo/world-generator/interaction";
import { roomAt, roomRects } from "@repo/world-generator/locate";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";

import { useMovementKeys } from "./controls";
import {
  EYE_HEIGHT,
  MAX_FRAME_SECONDS,
  MAX_STEP_DISTANCE,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
} from "./player-config";

/** A teleport target; a new `nonce` makes a repeat of the same place distinct. */
type Teleport = Placement & { readonly nonce: number };

type PlayerProps = {
  readonly world: BuiltWorld;
  /** False while the pointer is not locked: input is ignored and motion stops. */
  readonly enabled: boolean;
  /**
   * Called from the render loop whenever the player crosses into another
   * room (or corridor), with its id, or null outside every room. Fires once
   * for the start room after the world changes.
   */
  readonly onRoomChange?: (roomId: string | null) => void;
  /** Applied when it changes: the player is put there, looking at `facing`. */
  readonly placement?: Teleport | null;
  /** Called from the render loop once when the player steps into a portal. */
  readonly onPortal?: (portalId: string) => void;
  /** Called on change: the door or portal in front of the player, or null. */
  readonly onNearTarget?: (target: Target | null) => void;
};

const UP = new Vector3(0, 1, 0);
/** Higher is snappier; the velocity closes 1 - e^-SMOOTHING of the gap per second. */
const SMOOTHING = 10;
/**
 * Runs before the default-priority subscribers (the light pool), which then
 * see this frame's camera position. Stays negative: a positive priority would
 * take over rendering from React Three Fiber.
 */
const PRIORITY = -1;

const targetKey = (target: Target | null): string | null => {
  if (target === null) {
    return null;
  }
  return target.kind === "portal"
    ? `portal:${target.portalId}`
    : `door:${target.roomId}>${target.targetRoomId}`;
};

/** First-person movement, driven from the render loop without React state. */
const Player = ({
  world,
  enabled,
  onRoomChange,
  placement,
  onPortal,
  onNearTarget,
}: PlayerProps) => {
  const camera = useThree((state) => state.camera);
  const keys = useMovementKeys();
  const position = useRef<Point>(world.start);
  const velocity = useRef(new Vector3());
  const rects = useMemo(
    () => roomRects(world.rooms.map((built) => built.room)),
    [world]
  );
  const roomId = useRef<string | null>(null);
  /** False from a teleport until the player has left every portal trigger. */
  const armed = useRef(true);
  const nearKey = useRef<string | null>(null);
  const scratch = useRef({
    forward: new Vector3(),
    right: new Vector3(),
    target: new Vector3(),
  });

  /** Puts the player at `to`, looking at its facing point, with no momentum. */
  const place = useCallback(
    (to: Placement) => {
      position.current = to.position;
      velocity.current.set(0, 0, 0);
      camera.position.set(to.position.x, EYE_HEIGHT, to.position.z);
      camera.lookAt(to.facing.x, EYE_HEIGHT, to.facing.z);
    },
    [camera]
  );

  useLayoutEffect(() => {
    place({ position: world.start, facing: world.facing });
    // Forget the room too, so the first frame reports the new start room.
    roomId.current = null;
    armed.current = true;
    // The near-target key is kept on purpose: the next frame compares the
    // new world's answer against it and so reports a prompt that went away.
  }, [place, world]);

  useLayoutEffect(() => {
    if (placement !== null && placement !== undefined) {
      place(placement);
      // The landing is outside every trigger; stay disarmed until that is seen.
      armed.current = false;
    }
  }, [place, placement]);

  useFrame((_, delta) => {
    // A longer frame is a pause (tab switch, pointer-lock dialog), not motion:
    // simulate at most MAX_FRAME_SECONDS of it. Substepping keeps even that
    // step collision-safe.
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const { forward, right, target } = scratch.current;
    target.set(0, 0, 0);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) {
      forward.normalize();
    }
    if (enabled) {
      const held = keys.current;
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
    const current = roomAt(rects, next, roomId.current)?.id ?? null;
    if (current !== roomId.current) {
      roomId.current = current;
      onRoomChange?.(current);
    }
    if (world.portals.length === 0 && onNearTarget === undefined) {
      return;
    }
    const motion = {
      position: next,
      forward: { x: forward.x, z: forward.z },
      velocity: { x, z },
    };
    const hit = portalToEnter(world.portals, motion, armed.current);
    if (hit !== null) {
      armed.current = false;
      onPortal?.(hit.portal.id);
    } else if (!armed.current && !inAnyTrigger(world.portals, next)) {
      armed.current = true;
    }
    if (onNearTarget !== undefined) {
      const near = nearestTarget(world, current, motion);
      const key = targetKey(near);
      if (key !== nearKey.current) {
        nearKey.current = key;
        onNearTarget(near);
      }
    }
  }, PRIORITY);

  return null;
};

export { Player };
export type { Teleport };
