import { createContext, useContext } from "react";
import { MeshStandardMaterial, Vector2 } from "three";

import { createSurfaceTextures, TILE } from "./textures";
import type { SurfaceMaps } from "./textures";

/**
 * One material per surface type, shared by every mesh. Meshes that use them
 * must set `dispose={null}`; the World owns and disposes them.
 */
type Surfaces = {
  readonly wall: MeshStandardMaterial;
  readonly floor: MeshStandardMaterial;
  readonly ceiling: MeshStandardMaterial;
  /** The glowing fluorescent fixture body. */
  readonly fixture: MeshStandardMaterial;
  /** Dark wood door frames. */
  readonly frame: MeshStandardMaterial;
  /** The dark plane filling a call portal: a cold glow. */
  readonly voidCall: MeshStandardMaterial;
  /** The dark plane filling a return portal: a warm glow. */
  readonly voidReturn: MeshStandardMaterial;
  /** The dark plane filling a jump portal: neutral. */
  readonly voidJump: MeshStandardMaterial;
  /** The dark plane filling a module portal, to another file: green. */
  readonly voidModule: MeshStandardMaterial;
  /** The plane of a portal whose far side is not generated yet: dim, no glow. */
  readonly voidPending: MeshStandardMaterial;
  /** The dull, unlit board closing a marker: a call the world cannot follow. */
  readonly markerPanel: MeshStandardMaterial;
  readonly tile: typeof TILE;
  readonly dispose: () => void;
};

/** A near-black, faintly glowing surface, kept off the wall behind it. */
const voidMaterial = (emissive: string): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: "#07070a",
    emissive,
    emissiveIntensity: 0.9,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

/**
 * A surface's maps on a material. The ORM texture is read for roughness
 * (G) and occlusion (R) through the tiled `uv`, the only channel the room
 * geometry has; `roughness` stays 1 so the map alone sets it.
 */
const mapped = (
  { map, normalMap, orm }: SurfaceMaps,
  relief: number,
  occlusion: number
) => ({
  map,
  normalMap,
  normalScale: new Vector2(relief, relief),
  roughnessMap: orm,
  roughness: 1,
  aoMap: orm,
  aoMapIntensity: occlusion,
});

const createSurfaces = (anisotropy: number): Surfaces => {
  const textures = createSurfaceTextures(anisotropy);
  // Walls carry vertex colours: white as built, a lane's wash inside a fork
  // of a function.
  const wall = new MeshStandardMaterial({
    ...mapped(textures.wallpaper, 0.7, 0.7),
    vertexColors: true,
  });
  const floor = new MeshStandardMaterial(mapped(textures.carpet, 1, 0.9));
  const ceiling = new MeshStandardMaterial(mapped(textures.ceiling, 0.8, 0.8));
  const fixture = new MeshStandardMaterial({
    color: "#fff8e1",
    emissive: "#fff1c4",
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  // Frames are coloured per vertex: dark wood, or a lane's colour.
  const frame = new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.7,
    vertexColors: true,
  });
  const voidCall = voidMaterial("#1b2a4a");
  const voidReturn = voidMaterial("#4a1f12");
  const voidJump = voidMaterial("#2a2a2a");
  const voidModule = voidMaterial("#1c3f26");
  const voidPending = new MeshStandardMaterial({
    color: "#07070a",
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const markerPanel = new MeshStandardMaterial({
    color: "#4a4036",
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const materials = [
    wall,
    floor,
    ceiling,
    fixture,
    frame,
    voidCall,
    voidReturn,
    voidJump,
    voidModule,
    voidPending,
    markerPanel,
  ];
  return {
    wall,
    floor,
    ceiling,
    fixture,
    frame,
    voidCall,
    voidReturn,
    voidJump,
    voidModule,
    voidPending,
    markerPanel,
    tile: TILE,
    dispose: () => {
      for (const material of materials) {
        material.dispose();
      }
      for (const maps of Object.values(textures)) {
        for (const texture of Object.values(maps)) {
          texture.dispose();
        }
      }
    },
  };
};

const SurfacesContext = createContext<Surfaces | null>(null);

const useSurfaces = (): Surfaces => {
  const surfaces = useContext(SurfacesContext);
  if (surfaces === null) {
    throw new Error("useSurfaces must be used inside <World>");
  }
  return surfaces;
};

export { createSurfaces, SurfacesContext, useSurfaces };
