// Player dimensions in metres, speeds in metres per second.

const EYE_HEIGHT = 1.7;
/** Half-extent of the player's square footprint on the XZ plane. */
const PLAYER_RADIUS = 0.3;
const WALK_SPEED = 3.2;
const SPRINT_SPEED = 6;
/**
 * The most time one frame may simulate. Anything beyond it was a pause (tab
 * switch, pointer lock dialog), not motion, and is dropped.
 */
const MAX_FRAME_SECONDS = 0.25;
/**
 * Movement is substepped so no single step exceeds this, keeping it well below
 * wall thickness + player size and ruling out tunnelling at any frame rate.
 */
const MAX_STEP_DISTANCE = 0.1;

export {
  EYE_HEIGHT,
  MAX_FRAME_SECONDS,
  MAX_STEP_DISTANCE,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
};
