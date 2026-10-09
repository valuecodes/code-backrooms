import { createContext, useContext } from "react";
import { MeshStandardMaterial } from "three";

import { createSurfaceTextures, TILE } from "./textures";

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

const createSurfaces = (anisotropy: number): Surfaces => {
  const textures = createSurfaceTextures(anisotropy);
  // Walls carry vertex colours: white as built, a lane's wash inside a fork
  // of a function.
  const wall = new MeshStandardMaterial({
    map: textures.wallpaper,
    roughness: 0.85,
    vertexColors: true,
  });
  const floor = new MeshStandardMaterial({
    map: textures.carpet,
    roughness: 1,
  });
  const ceiling = new MeshStandardMaterial({
    map: textures.ceiling,
    roughness: 0.95,
  });
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
  const materials = [
    wall,
    floor,
    ceiling,
    fixture,
    frame,
    voidCall,
    voidReturn,
    voidJump,
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
    tile: TILE,
    dispose: () => {
      for (const material of materials) {
        material.dispose();
      }
      for (const texture of Object.values(textures)) {
        texture.dispose();
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
