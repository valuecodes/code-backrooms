// What the player can act on from where they stand: the portal they are
// stepping into, and the door or portal in front of them for a HUD prompt.
// Pure functions over the built world, so the rules are testable without
// a renderer.

import type { BuiltPortal, BuiltWorld, LaneLabel, Point } from "@repo/types";

import { openingCentre } from "./geometry";
import { containsPoint } from "./locate";

type Motion = {
  readonly position: Point;
  /** Unit vector the camera looks along, on the floor plane. */
  readonly forward: Point;
  /** Floor velocity in metres per second. */
  readonly velocity: Point;
};

type Target =
  | { readonly kind: "portal"; readonly portalId: string }
  | {
      readonly kind: "door";
      readonly roomId: string;
      /** The room on the other side, or the unit a corridor leads to. */
      readonly targetRoomId: string;
      /** The lane the door leads into, when walked with the flow. */
      readonly lane?: LaneLabel;
    };

/** How close a door or portal must be, in metres, to be prompted. */
const PROMPT_DISTANCE = 1.5;
/** Cosine of the half-angle within which something counts as "faced". */
const FACING = 0.5;
/**
 * Speed into the wall, in metres per second, below which the player is
 * standing, not walking in: a smoothed velocity only ever decays towards
 * zero, so an exact test would fire long after the keys were released.
 */
const MIN_APPROACH = 0.2;

const dot = (a: Point, b: Point): number => a.x * b.x + a.z * b.z;

/** Portals the player can step through: a marker is a closed frame. */
const enterable = (portal: BuiltPortal): boolean =>
  portal.portal.kind !== "marker";

/**
 * The portal the player enters this frame: they are inside its trigger
 * strip, looking into the wall and moving into it, so neither strafing past
 * a frame nor turning round in front of one fires it. `armed` is false
 * from a teleport until the player has left every trigger, which stops a
 * landing from firing the portal it landed beside.
 */
const portalToEnter = (
  portals: readonly BuiltPortal[],
  motion: Motion,
  armed: boolean
): BuiltPortal | null => {
  if (!armed) {
    return null;
  }
  const inside = portals.find(
    (portal) =>
      enterable(portal) && containsPoint(portal.trigger, motion.position)
  );
  if (inside === undefined) {
    return null;
  }
  const intoWall = { x: -inside.normal.x, z: -inside.normal.z };
  return dot(motion.forward, intoWall) > FACING &&
    dot(motion.velocity, intoWall) > MIN_APPROACH
    ? inside
    : null;
};

/** True while the player stands in some enterable portal's trigger strip. */
const inAnyTrigger = (
  portals: readonly BuiltPortal[],
  position: Point
): boolean =>
  portals.some(
    (portal) => enterable(portal) && containsPoint(portal.trigger, position)
  );

/**
 * The nearest door or portal of the player's room within PROMPT_DISTANCE
 * that they are facing, for the HUD to name. A door onto a corridor is
 * reported as leading to the room at the corridor's other end.
 */
const nearestTarget = (
  world: BuiltWorld,
  roomId: string | null,
  motion: Motion
): Target | null => {
  if (roomId === null) {
    return null;
  }
  const built = world.rooms.find(({ room }) => room.id === roomId);
  if (built === undefined) {
    return null;
  }
  // Corridors join units, so a corridor's far end is named by the unit.
  const unit = built.room.cluster ?? roomId;
  const beyond = (targetRoomId: string): string => {
    const connection = world.rooms.find(({ room }) => room.id === targetRoomId)
      ?.room.connection;
    if (connection === undefined) {
      return targetRoomId;
    }
    return connection.from === unit ? connection.to : connection.from;
  };
  const candidates: (readonly [Target, Point])[] = [
    ...built.openings.flatMap(
      (opening, index): (readonly [Target, Point])[] => {
        const door = built.room.doors[index];
        return door === undefined
          ? []
          : [
              [
                {
                  kind: "door",
                  roomId,
                  targetRoomId: beyond(door.targetRoomId),
                  // Only the way in names the lane; the way back names the room.
                  ...(opening.lane === undefined || door.forward !== true
                    ? {}
                    : { lane: opening.lane }),
                },
                openingCentre(built.room, opening),
              ],
            ];
      }
    ),
    ...world.portals
      .filter((portal) => portal.portal.from === roomId)
      .map((portal): readonly [Target, Point] => [
        { kind: "portal", portalId: portal.portal.id },
        { x: portal.frame.center[0], z: portal.frame.center[2] },
      ]),
  ];
  let best: { readonly target: Target; readonly distance: number } | null =
    null;
  for (const [target, point] of candidates) {
    const toPoint = {
      x: point.x - motion.position.x,
      z: point.z - motion.position.z,
    };
    const distance = Math.hypot(toPoint.x, toPoint.z);
    if (distance > PROMPT_DISTANCE || distance === 0) {
      continue;
    }
    const direction = { x: toPoint.x / distance, z: toPoint.z / distance };
    if (
      dot(motion.forward, direction) > FACING &&
      (best === null || distance < best.distance)
    ) {
      best = { target, distance };
    }
  }
  return best?.target ?? null;
};

export { inAnyTrigger, nearestTarget, portalToEnter, PROMPT_DISTANCE };
export type { Motion, Target };
