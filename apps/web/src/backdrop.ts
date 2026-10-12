import type { Placement } from "@repo/types";

// The landing page's moving backdrop: when it may run, and where its camera
// is at a given time. Pure, so both are tested without WebGL.

/** What the browser offers the backdrop. */
type BackdropSupport = {
  readonly webgl2: boolean;
};

/** Only with WebGL2. */
const backdropAllowed = ({ webgl2 }: BackdropSupport): boolean => webgl2;

/** Seconds for one walk out toward the doorway and back. */
const DRIFT_PERIOD = 36;
/** Seconds for one sway of the gaze from side to side. */
const SWAY_PERIOD = 13;
/** Radians the gaze turns to either side. */
const SWAY = 0.3;
/** The share of the way to the doorway the camera walks, and its cap in metres. */
const REACH_SHARE = 0.45;
const REACH_MAX = 5;
/** Metres ahead of the camera it looks at. */
const LOOK_AHEAD = 4;

/**
 * Where the camera is after `seconds`: it walks from `start.position` part
 * of the way toward `start.facing` and back, easing at both ends so the loop
 * never jumps, while its gaze sways gently around the way ahead.
 */
const driftPose = (start: Placement, seconds: number): Placement => {
  const { position, facing } = start;
  const dx = facing.x - position.x;
  const dz = facing.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) {
    return start;
  }
  const ux = dx / distance;
  const uz = dz / distance;
  const phase = (2 * Math.PI * seconds) / DRIFT_PERIOD;
  const walked =
    Math.min(distance * REACH_SHARE, REACH_MAX) * ((1 - Math.cos(phase)) / 2);
  const x = position.x + ux * walked;
  const z = position.z + uz * walked;
  const turn = SWAY * Math.sin((2 * Math.PI * seconds) / SWAY_PERIOD);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return {
    position: { x, z },
    facing: {
      x: x + (ux * cos - uz * sin) * LOOK_AHEAD,
      z: z + (ux * sin + uz * cos) * LOOK_AHEAD,
    },
  };
};

export { backdropAllowed, driftPose };
export type { BackdropSupport };
