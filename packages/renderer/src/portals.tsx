import type { BuiltPortal, PortalKind } from "@repo/types";
import {
  DOOR_HEIGHT,
  DOOR_WIDTH,
  WALL_THICKNESS,
} from "@repo/world-generator/config";
import { useEffect, useMemo } from "react";
import { PlaneGeometry } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { frameBoxes } from "./door-frames";
import { mergeBoxes } from "./merge";
import { useSurfaces } from "./surfaces";

type PortalsProps = {
  readonly portals: readonly BuiltPortal[];
};

/** Keeps the void plane clear of the wall's inner face. */
const LIFT = 0.01;

/** How a portal's plane looks: by its kind, or dim while it leads nowhere yet. */
type Look = PortalKind | "pending";

const LOOKS: readonly Look[] = [
  "call",
  "return",
  "jump",
  "marker",
  "module",
  "pending",
];

/**
 * A portal into an area that is not generated yet has no arrival; a marker
 * never leads anywhere and keeps its board.
 */
const lookOf = ({ portal, arrival }: BuiltPortal): Look =>
  arrival === null && portal.kind !== "marker" ? "pending" : portal.kind;

/**
 * One plane per portal of a look, standing on the wall's inner face and
 * facing into the room, merged into a single geometry.
 */
const voidPlanes = (
  portals: readonly BuiltPortal[],
  look: Look
): BufferGeometry | null => {
  const parts = portals
    .filter((portal) => lookOf(portal) === look)
    .map((portal) => {
      const [x, y, z] = portal.frame.center;
      const { normal } = portal;
      const lift = WALL_THICKNESS / 2 + LIFT;
      return new PlaneGeometry(DOOR_WIDTH, DOOR_HEIGHT)
        .rotateY(Math.atan2(normal.x, normal.z))
        .translate(
          x + normal.x * lift,
          y + DOOR_HEIGHT / 2,
          z + normal.z * lift
        );
    });
  if (parts.length === 0) {
    return null;
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
};

/**
 * Every portal in the world: the frames as one mesh (the same dark wood as
 * the doorways) and one plane mesh per kind, dark and faintly glowing, or
 * for a marker a dull board that closes the frame. A portal into an area
 * not generated yet stays dark until it is.
 */
const Portals = ({ portals }: PortalsProps) => {
  const surfaces = useSurfaces();
  const frames = useMemo(
    () =>
      mergeBoxes(
        portals.flatMap((portal) => frameBoxes(portal.frame)),
        1
      ),
    [portals]
  );
  const voids = useMemo(
    () => LOOKS.map((look) => [look, voidPlanes(portals, look)] as const),
    [portals]
  );
  useEffect(
    () => () => {
      frames?.dispose();
      for (const [, geometry] of voids) {
        geometry?.dispose();
      }
    },
    [frames, voids]
  );
  const materialOf = {
    call: surfaces.voidCall,
    return: surfaces.voidReturn,
    jump: surfaces.voidJump,
    marker: surfaces.markerPanel,
    module: surfaces.voidModule,
    pending: surfaces.voidPending,
  } satisfies Record<Look, unknown>;
  return (
    <group>
      {frames !== null && (
        <mesh
          geometry={frames}
          material={surfaces.frame}
          castShadow
          dispose={null}
        />
      )}
      {voids.map(([look, geometry]) =>
        geometry === null ? null : (
          <mesh
            key={look}
            geometry={geometry}
            material={materialOf[look]}
            dispose={null}
          />
        )
      )}
    </group>
  );
};

export { Portals };
