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
  readonly tile: typeof TILE;
  readonly dispose: () => void;
};

const createSurfaces = (anisotropy: number): Surfaces => {
  const textures = createSurfaceTextures(anisotropy);
  const wall = new MeshStandardMaterial({
    map: textures.wallpaper,
    roughness: 0.85,
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
  const frame = new MeshStandardMaterial({ color: "#4a3620", roughness: 0.7 });
  const materials = [wall, floor, ceiling, fixture, frame];
  return {
    wall,
    floor,
    ceiling,
    fixture,
    frame,
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
