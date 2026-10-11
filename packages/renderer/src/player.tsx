import { useFrame, useThree } from "@react-three/fiber";
import type { AreaWorld, BuiltArea, Placement, Point } from "@repo/types";
import { moveWithCollisions } from "@repo/world-generator/collision";
import {
  inAnyTrigger,
  nearestTarget,
  portalToEnter,
} from "@repo/world-generator/interaction";
import type { Target } from "@repo/world-generator/interaction";
import { areaAt, roomAt, roomRects } from "@repo/world-generator/locate";
import type { RoomRect } from "@repo/world-generator/locate";
import { useCallback, useLayoutEffect, useRef } from "react";
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
  /** The areas so far: the player starts in the entry and walks one at a time. */
  readonly world: AreaWorld;
  /** False while the pointer is not locked: input is ignored and motion stops. */
  readonly enabled: boolean;
  /**
   * Called from the render loop whenever the player crosses into another
   * room (or corridor), with its id, or null outside every room. Fires once
   * for the start room after the world's start changes.
   */
  readonly onRoomChange?: (roomId: string | null) => void;
  /** Applied when it changes: the player is put there, looking at `facing`. */
  readonly placement?: Teleport | null;
  /** Called from the render loop once when the player steps into a portal. */
  readonly onPortal?: (portalId: string) => void;
  /** Called on change: the door or portal in front of the player, or null. */
  readonly onNearTarget?: (target: Target | null) => void;
  /**
   * Called from the render loop with where the player stands and a point
   * 1 m ahead: at most every MOVE_INTERVAL seconds while walking, and on the
   * first frame after a room change, a teleport or a new world.
   */
  readonly onMove?: (pose: Placement) => void;
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
/** Seconds between `onMove` calls: often enough for a map, rare enough for React. */
const MOVE_INTERVAL = 0.1;

/** Each area's room footprints, worked out once: an area never changes. */
const rectsByArea = new WeakMap<BuiltArea, readonly RoomRect[]>();

const rectsOf = (area: BuiltArea): readonly RoomRect[] => {
  const known = rectsByArea.get(area);
  if (known !== undefined) {
    return known;
  }
  const created = roomRects(area.built.rooms.map((built) => built.room));
  rectsByArea.set(area, created);
  return created;
};

const NO_COLLIDERS: readonly [] = [];
const ORIGIN: Point = { x: 0, z: 0 };

const targetKey = (target: Target | null): string | null => {
  if (target === null) {
    return null;
  }
  return target.kind === "portal"
    ? `portal:${target.portalId}`
    : `door:${target.roomId}>${target.targetRoomId}`;
};

/**
 * First-person movement, driven from the render loop without React state.
 * Each frame looks only at the area the player stands in (areas lie
 * AREA_GAP apart, so nothing of another one is in reach).
 */
const Player = ({
  world,
  enabled,
  onRoomChange,
  placement,
  onPortal,
  onNearTarget,
  onMove,
}: PlayerProps) => {
  const camera = useThree((state) => state.camera);
  const keys = useMovementKeys();
  // The same object while the world grows: the entry is never generated again.
  const entry = world.areas.find((area) => area.id === world.entry)?.built;
  const position = useRef<Point>(entry?.start ?? ORIGIN);
  const velocity = useRef(new Vector3());
  const areaId = useRef<string | null>(null);
  const roomId = useRef<string | null>(null);
  /** False from a teleport until the player has left every portal trigger. */
  const armed = useRef(true);
  const nearKey = useRef<string | null>(null);
  /** Seconds since the last `onMove`; infinite means "report on the next frame". */
  const sinceMove = useRef(Number.POSITIVE_INFINITY);
  /** The last pose `onMove` reported, as a key. */
  const lastPose = useRef("");
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
      sinceMove.current = Number.POSITIVE_INFINITY;
    },
    [camera]
  );

  // Keyed on the start, not the world: a world that grew (another area
  // joined in) keeps its start objects, and the player stays where they are.
  const start = entry?.start;
  const facing = entry?.facing;
  useLayoutEffect(() => {
    if (start === undefined || facing === undefined) {
      return;
    }
    place({ position: start, facing });
    // Forget the area and room too, so the first frame reports the start room.
    areaId.current = null;
    roomId.current = null;
    armed.current = true;
    // The near-target key is kept on purpose: the next frame compares the
    // new world's answer against it and so reports a prompt that went away.
  }, [place, start, facing]);

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
    // Outside every area (a teleport into one this render has not seen
    // yet) there is nothing to collide with for a frame.
    const area = areaAt(world.areas, position.current, areaId.current);
    areaId.current = area?.id ?? null;
    const built = area?.built ?? null;
    const next = moveWithCollisions(
      position.current,
      { x: x * dt, z: z * dt },
      PLAYER_RADIUS,
      built?.colliders ?? NO_COLLIDERS,
      MAX_STEP_DISTANCE
    );
    position.current = next;
    camera.position.set(next.x, EYE_HEIGHT, next.z);
    const current =
      area === null
        ? null
        : (roomAt(rectsOf(area), next, roomId.current)?.id ?? null);
    if (current !== roomId.current) {
      roomId.current = current;
      onRoomChange?.(current);
      sinceMove.current = Number.POSITIVE_INFINITY;
    }
    sinceMove.current += dt;
    if (onMove !== undefined && sinceMove.current >= MOVE_INTERVAL) {
      const forced = sinceMove.current === Number.POSITIVE_INFINITY;
      sinceMove.current = 0;
      const pose = `${next.x},${next.z},${forward.x},${forward.z}`;
      // Standing still and not looking round: nothing new to report.
      if (forced || pose !== lastPose.current) {
        lastPose.current = pose;
        onMove({
          position: next,
          facing: { x: next.x + forward.x, z: next.z + forward.z },
        });
      }
    }
    const portals = built?.portals ?? [];
    if (portals.length === 0 && onNearTarget === undefined) {
      return;
    }
    const motion = {
      position: next,
      forward: { x: forward.x, z: forward.z },
      velocity: { x, z },
    };
    const hit = portalToEnter(portals, motion, armed.current);
    if (hit !== null) {
      armed.current = false;
      onPortal?.(hit.portal.id);
    } else if (!armed.current && !inAnyTrigger(portals, next)) {
      armed.current = true;
    }
    if (onNearTarget !== undefined) {
      const near =
        built === null ? null : nearestTarget(built, current, motion);
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
