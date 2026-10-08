import { Canvas } from "@react-three/fiber";
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";
import type { GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { presets } from "@repo/world-generator/presets";
import { useEffect, useMemo, useState } from "react";

import { Hud } from "~/hud";
import { parseWorldParams, withSeed } from "~/params";

type Generated =
  | { readonly world: GeneratedWorld; readonly error: null }
  | { readonly world: null; readonly error: string };

const initial = parseWorldParams(globalThis.location.search);

/**
 * Builds the world once per seed: it never regenerates while the player moves.
 * Generation errors (an unplaceable supplied graph) are shown, not thrown
 * through the renderer.
 */
const useGeneratedWorld = (seed: number): Generated =>
  useMemo(() => {
    try {
      const world = generateWorld({
        seed,
        roomCount: initial.rooms,
        graph: initial.preset === null ? undefined : presets[initial.preset],
      });
      for (const { from, to } of world.layout.unresolved) {
        console.warn(`Connection ${from} -> ${to} could not be laid out`);
      }
      return { world, error: null };
    } catch (error) {
      return { world: null, error: String(error) };
    }
  }, [seed]);

const App = () => {
  const [locked, setLocked] = useState(false);
  const [seed, setSeed] = useState(initial.seed);
  const generated = useGeneratedWorld(seed);

  // N: next seed. Only this regenerates the world.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyN" && !event.repeat) {
        setSeed((current) => current + 1);
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the URL shareable: it always names the seed on screen.
  useEffect(() => {
    if (seed !== initial.seed) {
      globalThis.history.replaceState(
        null,
        "",
        withSeed(globalThis.location.search, seed)
      );
    }
  }, [seed]);

  // The browser owns the lock state: one listener covers locks, Esc, and a
  // failed generation unmounting the Canvas mid-lock.
  useEffect(() => {
    const sync = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", sync);
    return () => document.removeEventListener("pointerlockchange", sync);
  }, []);
  useEffect(() => {
    if (generated.error !== null && document.pointerLockElement !== null) {
      document.exitPointerLock();
    }
  }, [generated.error]);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black">
      {generated.world !== null && (
        <Canvas
          shadows="percentage"
          dpr={[1, 1.25]}
          camera={{ fov: 75, near: 0.05, far: 32 }}
          gl={{ antialias: true }}
          // The scene is static and the player casts nothing: the light pool
          // requests a shadow render only when its shadow light moves.
          onCreated={({ gl }) => {
            gl.shadowMap.autoUpdate = false;
            gl.shadowMap.needsUpdate = true;
          }}
        >
          <World world={generated.world.built} />
          <Player world={generated.world.built} enabled={locked} />
          <PointerLook />
        </Canvas>
      )}
      <Hud
        locked={locked}
        seed={seed}
        rooms={generated.world?.graph.rooms.length ?? 0}
        preset={initial.preset}
        error={generated.error}
      />
    </div>
  );
};

export { App };
