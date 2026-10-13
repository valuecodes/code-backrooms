import { DataTexture, HalfFloatType, LinearFilter, RGBAFormat } from "three";
import type { MeshStandardMaterial } from "three";

import type { BakedLightmap } from "./bake";
import type { BakeQueue } from "./bake-client";
import { areaFixtures, LIGHT_DROP } from "./fixtures";
import { layoutArea } from "./lightmap-layout";
import type { AreaLayout, AreaRooms } from "./lightmap-layout";

/** The lightmapped surfaces of one area: its own copies of the shared materials. */
type AreaLighting = {
  readonly layout: AreaLayout;
  readonly wall: MeshStandardMaterial;
  readonly floor: MeshStandardMaterial;
  readonly ceiling: MeshStandardMaterial;
};

type LightmappedSurfaces = Pick<AreaLighting, "wall" | "floor" | "ceiling">;

type LightingStore = {
  /** An area's lighting, made on first ask: placeholder-lit until baked. */
  readonly get: (area: AreaRooms) => AreaLighting;
  /** Bakes the areas not baked yet; drops what is kept for areas gone. */
  readonly sync: (areas: readonly AreaRooms[]) => void;
  /**
   * Cancels unfinished bakes and frees the GPU side of every material and
   * map, but keeps each area's lighting usable: three uploads again on the
   * next draw, and the next `sync` queues the cancelled bakes again. So a
   * StrictMode unmount and remount leaves the rendered materials valid.
   */
  readonly dispose: () => void;
};

/**
 * Texels baked at once across a World, 64 MiB of half-float RGBA. An area
 * past it keeps the placeholder.
 */
const WORLD_TEXEL_BUDGET = 8 * 1024 * 1024;

/** A lightmap texture as the materials read it: through `uv1`, filtered. */
const lightmapTexture = (
  data: Uint16Array,
  width: number,
  height: number
): DataTexture => {
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    HalfFloatType
  );
  texture.channel = 1;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** The cancel of an area never queued. */
const nothing = (): void => undefined;

type Entry = {
  readonly lighting: AreaLighting;
  readonly texels: number;
  /**
   * `new`: not queued yet. `queued`: waiting or baking, cancelled by
   * `cancel`. `baked`: its map is on the materials. `over`: the budget had
   * no room, tried again once some is freed. `failed`: its bake failed;
   * not tried again.
   */
  state: "new" | "queued" | "baked" | "over" | "failed";
  cancel: () => void;
  texture: DataTexture | null;
};

/**
 * Lighting per area, keyed by the area object: a regenerated or reseeded
 * area is a new object, so a bake for the old one can never land on it.
 * Each area's materials are clones of the shared ones, which carry the
 * placeholder lightmap: the same maps and defines, so the same shader
 * program, and swapping in the baked map recompiles nothing.
 */
const createAreaLighting = (
  surfaces: LightmappedSurfaces,
  queue: BakeQueue,
  budget = WORLD_TEXEL_BUDGET
): LightingStore => {
  const entries = new Map<AreaRooms, Entry>();
  let used = 0;
  let warned = false;

  const ensure = (area: AreaRooms): Entry => {
    const known = entries.get(area);
    if (known !== undefined) {
      return known;
    }
    const layout = layoutArea(area);
    const entry: Entry = {
      lighting: {
        layout,
        wall: surfaces.wall.clone(),
        floor: surfaces.floor.clone(),
        ceiling: surfaces.ceiling.clone(),
      },
      texels: layout.width * layout.height,
      state: "new",
      cancel: nothing,
      texture: null,
    };
    entries.set(area, entry);
    return entry;
  };

  /** Stops its bake if unfinished and frees its GPU side; usable after. */
  const free = (entry: Entry) => {
    if (entry.state === "queued") {
      entry.cancel();
      used -= entry.texels;
      entry.state = "new";
    }
    entry.texture?.dispose();
    entry.lighting.wall.dispose();
    entry.lighting.floor.dispose();
    entry.lighting.ceiling.dispose();
  };

  /** Lets go of an area for good. */
  const release = (area: AreaRooms, entry: Entry) => {
    free(entry);
    if (entry.state === "baked") {
      used -= entry.texels;
    }
    entries.delete(area);
  };

  const land = (entry: Entry, lightmap: BakedLightmap) => {
    const texture = lightmapTexture(
      lightmap.data,
      lightmap.width,
      lightmap.height
    );
    entry.texture = texture;
    entry.lighting.wall.lightMap = texture;
    entry.lighting.floor.lightMap = texture;
    entry.lighting.ceiling.lightMap = texture;
  };

  const bake = (area: AreaRooms, entry: Entry) => {
    if (used + entry.texels > budget) {
      if (!warned) {
        warned = true;
        console.warn(
          "lightmap budget spent: later areas keep the flat fill light"
        );
      }
      entry.state = "over";
      return;
    }
    used += entry.texels;
    entry.state = "queued";
    const { layout } = entry.lighting;
    entry.cancel = queue.request(
      {
        layout: {
          width: layout.width,
          height: layout.height,
          texel: layout.texel,
          faces: layout.faces,
          solids: layout.solids,
        },
        lights: areaFixtures(area).map(
          ({ x, z, ceiling }) => [x, ceiling - LIGHT_DROP, z] as const
        ),
      },
      (lightmap) => {
        // The queue never answers a cancelled job, so this entry is live.
        if (lightmap === null) {
          // Failed: keep the placeholder and give its texels to an area
          // that was waiting for them.
          used -= entry.texels;
          entry.state = "failed";
          bakeWaiting();
          return;
        }
        entry.state = "baked";
        land(entry, lightmap);
      }
    );
  };

  /** Bakes, in order, the areas still to bake and those the budget held back. */
  const bakeWaiting = () => {
    for (const [area, entry] of entries) {
      if (entry.state === "new" || entry.state === "over") {
        bake(area, entry);
      }
    }
  };

  return {
    get: (area) => ensure(area).lighting,
    sync: (areas) => {
      const current = new Set(areas);
      for (const [area, entry] of entries) {
        if (!current.has(area)) {
          release(area, entry);
        }
      }
      for (const area of areas) {
        ensure(area);
      }
      bakeWaiting();
    },
    dispose: () => {
      for (const entry of entries.values()) {
        free(entry);
      }
      queue.dispose();
    },
  };
};

export { createAreaLighting, lightmapTexture };
export type { AreaLighting };
