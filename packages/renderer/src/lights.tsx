import { useFrame } from "@react-three/fiber";
import { hashString } from "@repo/world-generator/random";
import { useEffect, useMemo, useRef } from "react";
import type { PointLight, RectAreaLight } from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

import type { FixturePoint } from "./fixtures";
import {
  LIGHT_COLOR,
  LIGHT_DISTANCE,
  LIGHT_DROP,
  LIGHT_INTENSITY,
} from "./fixtures";
import { DIFFUSER, DIFFUSER_DROP } from "./troffer";

type LightPoolProps = {
  readonly fixtures: readonly FixturePoint[];
};

/** Lights in flight at once. Fixed, so the shaders compile exactly once. */
const POOL_SIZE = 8;

/**
 * Area lights on the nearest fixtures, for the diffuser's true shape in the
 * floor's sheen. Always mounted, so their count, too, is fixed.
 */
const RECT_COUNT = 2;
/**
 * The share of a fixture's light its area light takes; the point light at
 * the same fixture keeps the rest, and with it the shadow.
 */
const RECT_SHARE = 0.6;
const DIFFUSER_AREA = DIFFUSER.length * DIFFUSER.width;

/** An area light emits along its −z: turned to face the floor. */
const FACING_DOWN = [-Math.PI / 2, 0, 0] as const;

let rectAreaReady = false;

/** The area-light lookup tables, set up once per page. */
const prepareRectAreaLights = () => {
  if (!rectAreaReady) {
    RectAreaLightUniformsLib.init();
    rectAreaReady = true;
  }
};

/** Slot 0 (the nearest fixture) is the one shadow caster. */
const SHADOW_SLOT = 0;

/** Seconds a fixture's buzz is offset by at most; longer than its slowest beat. */
const FLICKER_PERIOD = 10;

const flicker = (t: number): number =>
  0.93 + 0.07 * Math.sin(t * 23) * Math.sin(t * 7.3) * Math.sin(t * 1.7);

/** Every fixture buzzes on its own phase, fixed by where it hangs. */
const phaseOf = ({ x, z }: FixturePoint): number =>
  (hashString(`${x},${z}`) / 2 ** 32) * FLICKER_PERIOD;

/**
 * Keeps the K nearest fixture indices to (x, z), nearest first. A plain
 * insertion into a small fixed array: no allocation, no full sort.
 */
const nearestFixtures = (
  fixtures: readonly FixturePoint[],
  x: number,
  z: number,
  into: number[],
  distances: number[]
): number => {
  let count = 0;
  for (let i = 0; i < fixtures.length; i += 1) {
    const fixture = fixtures[i];
    if (fixture === undefined) {
      continue;
    }
    const d = (fixture.x - x) ** 2 + (fixture.z - z) ** 2;
    if (count === POOL_SIZE && d >= (distances[count - 1] ?? Infinity)) {
      continue;
    }
    let slot = Math.min(count, POOL_SIZE - 1);
    while (slot > 0 && (distances[slot - 1] ?? Infinity) > d) {
      distances[slot] = distances[slot - 1] ?? Infinity;
      into[slot] = into[slot - 1] ?? -1;
      slot -= 1;
    }
    distances[slot] = d;
    into[slot] = i;
    count = Math.min(count + 1, POOL_SIZE);
  }
  return count;
};

/**
 * A fixed pool of point lights that follows the player: each frame the lights
 * move to the nearest fixtures, and the nearest few also get an area light
 * the size of the diffuser. The shadow map is static (the Canvas turns
 * `shadowMap.autoUpdate` off), re-rendered only when the shadow light hops to
 * a new fixture or the world changes.
 */
const LightPool = ({ fixtures }: LightPoolProps) => {
  prepareRectAreaLights();
  const lights = useRef<(PointLight | null)[]>([]);
  const rects = useRef<(RectAreaLight | null)[]>([]);
  const nearest = useRef<number[]>([]);
  const distances = useRef<number[]>([]);
  const shadowFixture = useRef(-1);
  const phases = useMemo(() => fixtures.map(phaseOf), [fixtures]);

  // A new world (new fixtures) needs a fresh shadow map even if the shadow
  // light happens to land on the same fixture index.
  useEffect(() => {
    shadowFixture.current = -1;
  }, [fixtures]);

  useFrame(({ camera, clock, gl }) => {
    const count = nearestFixtures(
      fixtures,
      camera.position.x,
      camera.position.z,
      nearest.current,
      distances.current
    );
    const { x, z } = camera.position;
    let rectsUsed = 0;
    for (let slot = 0; slot < POOL_SIZE; slot += 1) {
      const light = lights.current[slot];
      const index = nearest.current[slot];
      const fixture = index === undefined ? undefined : fixtures[index];
      if (light === null || light === undefined) {
        continue;
      }
      if (slot >= count || fixture === undefined || index === undefined) {
        light.intensity = 0;
        continue;
      }
      light.position.set(fixture.x, fixture.ceiling - LIGHT_DROP, fixture.z);
      // The phase follows the fixture, so a light keeps its buzz when the
      // pool hands it to another slot.
      const strength =
        LIGHT_INTENSITY * flicker(clock.elapsedTime + (phases[index] ?? 0));
      // Area lights cast no shadow: only a fixture over the player's own
      // room gets one, so none shines through a wall. The rest stay whole
      // point lights.
      const { room } = fixture;
      const rect =
        rectsUsed < RECT_COUNT &&
        x >= room.minX &&
        x <= room.maxX &&
        z >= room.minZ &&
        z <= room.maxZ
          ? rects.current[rectsUsed]
          : null;
      if (rect) {
        rectsUsed += 1;
        // An area light's intensity is luminance: a fixture's on-axis
        // intensity spread over the diffuser.
        rect.position.set(
          fixture.x,
          fixture.ceiling - DIFFUSER_DROP - DIFFUSER.thickness,
          fixture.z
        );
        rect.intensity = (strength * RECT_SHARE) / DIFFUSER_AREA;
        light.intensity = strength * (1 - RECT_SHARE);
      } else {
        light.intensity = strength;
      }
      if (slot === SHADOW_SLOT && index !== shadowFixture.current) {
        shadowFixture.current = index;
        gl.shadowMap.needsUpdate = true;
      }
    }
    for (let slot = rectsUsed; slot < RECT_COUNT; slot += 1) {
      const rect = rects.current[slot];
      if (rect) {
        rect.intensity = 0;
      }
    }
  });

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, slot) => (
        <pointLight
          key={slot}
          ref={(light) => {
            lights.current[slot] = light;
          }}
          color={LIGHT_COLOR}
          intensity={0}
          distance={LIGHT_DISTANCE}
          decay={2}
          castShadow={slot === SHADOW_SLOT}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.003}
          shadow-camera-far={12}
        />
      ))}
      {Array.from({ length: RECT_COUNT }, (_, slot) => (
        <rectAreaLight
          key={`rect-${slot}`}
          ref={(light) => {
            rects.current[slot] = light;
          }}
          color={LIGHT_COLOR}
          intensity={0}
          width={DIFFUSER.length}
          height={DIFFUSER.width}
          rotation={FACING_DOWN}
        />
      ))}
    </>
  );
};

export { LightPool };
