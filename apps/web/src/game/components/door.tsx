import { Wall } from "~/game/components/wall";
import { DOOR_HEIGHT } from "~/game/config";
import { useSurfaces } from "~/game/surfaces";
import type { WallSegment } from "~/game/types";

type DoorProps = {
  /** The lintel segment; the opening itself is the gap below it. */
  readonly segment: WallSegment;
};

const TRIM = 0.05;
/** How far the frame stands proud of the wall on each side. */
const PROUD = 0.02;

/** A door opening: the wallpapered lintel above it plus a dark wooden frame. */
const Door = ({ segment }: DoorProps) => {
  const surfaces = useSurfaces();
  const [x, , z] = segment.center;
  const [sizeX, , sizeZ] = segment.size;
  const alongX = sizeX > sizeZ;
  const width = alongX ? sizeX : sizeZ;
  const depth = (alongX ? sizeZ : sizeX) + PROUD * 2;
  const headSize: readonly [number, number, number] = alongX
    ? [width + TRIM * 2, TRIM, depth]
    : [depth, TRIM, width + TRIM * 2];
  const jambSize: readonly [number, number, number] = alongX
    ? [TRIM, DOOR_HEIGHT, depth]
    : [depth, DOOR_HEIGHT, TRIM];
  const offset = width / 2 + TRIM / 2;
  const jambs: readonly (readonly [number, number, number])[] = alongX
    ? [
        [x - offset, DOOR_HEIGHT / 2, z],
        [x + offset, DOOR_HEIGHT / 2, z],
      ]
    : [
        [x, DOOR_HEIGHT / 2, z - offset],
        [x, DOOR_HEIGHT / 2, z + offset],
      ];
  return (
    <group>
      <Wall segment={segment} />
      <mesh
        position={[x, DOOR_HEIGHT + TRIM / 2, z]}
        material={surfaces.frame}
        castShadow
        dispose={null}
      >
        <boxGeometry args={headSize} />
      </mesh>
      {jambs.map((position) => (
        <mesh
          key={position.join(",")}
          position={position}
          material={surfaces.frame}
          castShadow
          dispose={null}
        >
          <boxGeometry args={jambSize} />
        </mesh>
      ))}
    </group>
  );
};

export { Door };
