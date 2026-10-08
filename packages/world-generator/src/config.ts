// World dimensions are metres. Y is up.

/** Floor-to-ceiling height of every room. */
const WALL_HEIGHT = 2.7;
/** Walls are boxes inset inside the room footprint, this thick. */
const WALL_THICKNESS = 0.15;
const DOOR_WIDTH = 1.2;
const DOOR_HEIGHT = 2.1;

/** Room edges snap to this lattice, so shared edges compare exactly. */
const GRID = 0.5;

const CORRIDOR_WIDTH = 2;
/** Corridor lengths tried when a neighbour does not fit against a wall. */
const CORRIDOR_LENGTHS: readonly number[] = [2, 3, 4, 6, 8, 10, 14];
const MAX_CORRIDOR_LENGTH = 14;

/**
 * Unrelated rooms keep at least this much air between them. It equals the
 * shortest corridor, so any two rooms that are apart can still be joined.
 */
const MIN_GAP = 2;

/**
 * The least two connected rooms may overlap along their shared edge. The
 * door (1.2) plus the wall thickness lost at each corner (2 x 0.15) is the
 * hard floor; the rest keeps the jambs clear of the corner boxes.
 */
const MIN_SHARED = DOOR_WIDTH + 2 * WALL_THICKNESS + 0.5;

type SizeClass = {
  readonly min: number;
  readonly max: number;
  readonly weight: number;
};

const ROOM_SIZE_CLASSES: Readonly<
  Record<"small" | "medium" | "large", SizeClass>
> = {
  small: { min: 5, max: 8, weight: 45 },
  medium: { min: 8, max: 12, weight: 45 },
  large: { min: 12, max: 20, weight: 10 },
};

/** Random graphs never give a room more neighbours than its walls can hold. */
const MAX_DEGREE = 6;

/** Whole-layout retries with a bumped seed before giving up on a graph. */
const MAX_LAYOUT_ATTEMPTS = 16;

export {
  CORRIDOR_LENGTHS,
  CORRIDOR_WIDTH,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  GRID,
  MAX_CORRIDOR_LENGTH,
  MAX_DEGREE,
  MAX_LAYOUT_ATTEMPTS,
  MIN_GAP,
  MIN_SHARED,
  ROOM_SIZE_CLASSES,
  WALL_HEIGHT,
  WALL_THICKNESS,
};
