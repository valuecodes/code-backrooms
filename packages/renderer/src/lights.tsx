import { useFrame } from "@react-three/fiber";
import { hashString } from "@repo/world-generator/random";
import { useEffect, useMemo, useRef } from "react";
import type { PointLight } from "three";

import type { FixturePoint } from "./fixtures";
import { LIGHT_DROP } from "./fixtures";

type LightPoolProps = {
  readonly fixtures: readonly FixturePoint[];
};

/** Lights in flight at once. Fixed, so the shaders compile exactly once. */
const POOL_SIZE = 8;
const LIGHT_INTENSITY = 14;
const LIGHT_COLOR = "#fff2cc";
const LIGHT_DISTANCE = 9;

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
 * move to the nearest fixtures. The shadow map is static (the Canvas turns
 * `shadowMap.autoUpdate` off), re-rendered only when the shadow light hops to
 * a new fixture or the world changes.
 */
const LightPool = ({ fixtures }: LightPoolProps) => {
  const lights = useRef<(PointLight | null)[]>([]);
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
      light.intensity =
        LIGHT_INTENSITY * flicker(clock.elapsedTime + (phases[index] ?? 0));
      if (slot === SHADOW_SLOT && index !== shadowFixture.current) {
        shadowFixture.current = index;
        gl.shadowMap.needsUpdate = true;
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
    </>
  );
};

export { LightPool };
