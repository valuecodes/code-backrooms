import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry } from "three";
import type { PointLight } from "three";

import { LIGHT_SPACING, WALL_HEIGHT } from "~/game/config";
import { useSurfaces } from "~/game/surfaces";
import { tiledPlane } from "~/game/tiled-geometry";
import type { RoomData } from "~/game/types";

type CeilingProps = {
  readonly room: RoomData;
};

const LIGHT_INTENSITY = 14;
const LIGHT_COLOR = "#fff2cc";

/** Fixture centres on a grid roughly LIGHT_SPACING apart, centred in the room. */
const fixturePositions = (
  room: RoomData
): readonly (readonly [number, number])[] => {
  const columns = Math.max(1, Math.round(room.width / LIGHT_SPACING));
  const rows = Math.max(1, Math.round(room.depth / LIGHT_SPACING));
  const stepX = room.width / columns;
  const stepZ = room.depth / rows;
  const [cx, , cz] = room.position;
  const positions: (readonly [number, number])[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push([
        cx - room.width / 2 + stepX * (column + 0.5),
        cz - room.depth / 2 + stepZ * (row + 0.5),
      ]);
    }
  }
  return positions;
};

const Ceiling = ({ room }: CeilingProps) => {
  const surfaces = useSurfaces();
  const [x, y, z] = room.position;
  const top = y + WALL_HEIGHT;
  const geometry = useMemo(
    () => tiledPlane(room.width, room.depth, surfaces.tile.ceiling),
    [room.width, room.depth, surfaces.tile.ceiling]
  );
  const fixtureGeometry = useMemo(() => new BoxGeometry(1.2, 0.08, 0.3), []);
  useEffect(
    () => () => {
      geometry.dispose();
      fixtureGeometry.dispose();
    },
    [geometry, fixtureGeometry]
  );
  const fixtures = useMemo(() => fixturePositions(room), [room]);
  // One light per room casts shadows; the first one buzzes and flickers.
  const shadowIndex = Math.floor(fixtures.length / 2);
  const flickering = useRef<PointLight>(null);

  useFrame(({ clock }) => {
    const light = flickering.current;
    if (light === null) {
      return;
    }
    const t = clock.elapsedTime;
    const buzz = Math.sin(t * 23) * Math.sin(t * 7.3) * Math.sin(t * 1.7);
    light.intensity = LIGHT_INTENSITY * (0.93 + 0.07 * buzz);
  });

  return (
    <group>
      <mesh
        geometry={geometry}
        material={surfaces.ceiling}
        position={[x, top, z]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
        dispose={null}
      />
      {fixtures.map(([fx, fz], index) => (
        <group key={`${fx},${fz}`}>
          <mesh
            geometry={fixtureGeometry}
            material={surfaces.fixture}
            position={[fx, top - 0.04, fz]}
            dispose={null}
          />
          <pointLight
            ref={index === 0 ? flickering : undefined}
            position={[fx, top - 0.3, fz]}
            color={LIGHT_COLOR}
            intensity={LIGHT_INTENSITY}
            distance={9}
            decay={2}
            castShadow={index === shadowIndex}
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.003}
          />
        </group>
      ))}
    </group>
  );
};

export { Ceiling };
