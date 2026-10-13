import type { Box } from "./merge";

/**
 * A surface-mounted 2 × 4 ft troffer: the ceiling is one uncut plane per
 * room, so the fixture hangs below it rather than sitting in a recess. A
 * shallow enamelled pan (back plate and four rim bars) and a diffuser set
 * up inside the rim. Long side along x.
 */
const HOUSING = {
  length: 1.22,
  width: 0.61,
  plate: 0.02,
  rim: 0.06,
  bar: 0.03,
};
/** The glowing panel: just inside the rim, set up from its lower edge. */
const DIFFUSER = { length: 1.16, width: 0.55, thickness: 0.005, inset: 0.02 };

type FixtureAt = {
  readonly x: number;
  readonly z: number;
  readonly ceiling: number;
};

/** The pan of one troffer: back plate against the ceiling and four rim bars. */
const housingBoxes = ({ x, z, ceiling }: FixtureAt): Box[] => {
  const { length, width, plate, rim, bar } = HOUSING;
  const rimY = ceiling - plate - rim / 2;
  return [
    { center: [x, ceiling - plate / 2, z], size: [length, plate, width] },
    { center: [x, rimY, z - width / 2 + bar / 2], size: [length, rim, bar] },
    { center: [x, rimY, z + width / 2 - bar / 2], size: [length, rim, bar] },
    {
      center: [x - length / 2 + bar / 2, rimY, z],
      size: [bar, rim, width - bar * 2],
    },
    {
      center: [x + length / 2 - bar / 2, rimY, z],
      size: [bar, rim, width - bar * 2],
    },
  ];
};

/** How far below the ceiling the diffuser's centre sits. */
const DIFFUSER_DROP = HOUSING.plate + HOUSING.rim - DIFFUSER.inset;

/** The diffuser panel of one troffer, inside the rim. */
const diffuserBox = ({ x, z, ceiling }: FixtureAt): Box => ({
  center: [x, ceiling - DIFFUSER_DROP, z],
  size: [DIFFUSER.length, DIFFUSER.thickness, DIFFUSER.width],
});

export { DIFFUSER, DIFFUSER_DROP, diffuserBox, housingBoxes };
