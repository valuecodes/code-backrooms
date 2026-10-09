import { Canvas } from "@react-three/fiber";
import type { CodeGraph } from "@repo/code-graph";
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";
import type { GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import type { Target } from "@repo/world-generator/interaction";
import { presets } from "@repo/world-generator/presets";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Hud } from "~/hud";
import { parseWorldParams, withSeed } from "~/params";
import { useNavigation } from "~/use-navigation";
import {
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  worldFromCode,
} from "~/world-from-code";

type Generated = {
  readonly world: GeneratedWorld | null;
  readonly codeGraph: CodeGraph | null;
  /** Graph connections and portals the layout could not realise, one line each. */
  readonly warnings: readonly string[];
  readonly error: string | null;
};

const initial = parseWorldParams(globalThis.location.search);

// Parsed once: a syntax error in a bundled example does not depend on the
// seed, and it is shown in the HUD rather than thrown through the renderer.
const code = initial.code === null ? null : codeGraphOf(initial.code);

const generate = (seed: number): GeneratedWorld => {
  const codeGraph = code?.codeGraph ?? null;
  if (codeGraph !== null) {
    return worldFromCode(codeGraph, seed);
  }
  return generateWorld({
    seed,
    roomCount: initial.rooms,
    graph: initial.preset === null ? undefined : presets[initial.preset],
  });
};

/**
 * Builds the world once per seed: it never regenerates while the player moves.
 * Generation errors (an unplaceable graph) are shown, not thrown.
 */
const useGeneratedWorld = (seed: number): Generated =>
  useMemo(() => {
    const codeGraph = code?.codeGraph ?? null;
    if (code !== null && code.error !== null) {
      return { world: null, codeGraph, warnings: [], error: code.error };
    }
    try {
      const world = generate(seed);
      // Shown in the HUD, so the console stays quiet.
      const warnings = [
        ...world.layout.unresolved.map(
          ({ from, to }) => `${from} -> ${to} could not be laid out`
        ),
        ...world.layout.unplacedPortals.map(
          ({ id }) => `${id} has no wall space`
        ),
      ];
      return { world, codeGraph, warnings, error: null };
    } catch (error) {
      return { world: null, codeGraph, warnings: [], error: String(error) };
    }
  }, [seed]);

const App = () => {
  const [locked, setLocked] = useState(false);
  const [seed, setSeed] = useState(initial.seed);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const generated = useGeneratedWorld(seed);
  const navigation = useNavigation(generated.world);
  const { onRoomChange, back, home } = navigation;

  const onRoom = useCallback(
    (id: string | null) => {
      setRoomId(id);
      onRoomChange(id);
    },
    [onRoomChange]
  );

  // N: next seed (the only thing that regenerates the world). Backspace and
  // R navigate, and only while walking, so a free pointer leaves them alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+R and friends belong to the browser.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.code === "KeyN") {
        setSeed((current) => current + 1);
      } else if (locked && event.code === "Backspace") {
        event.preventDefault();
        back();
      } else if (locked && event.code === "KeyR") {
        home();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [locked, back, home]);

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

  const place =
    roomId === null ? null : describeRoom(generated.codeGraph, roomId);

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
          <Player
            world={generated.world.built}
            enabled={locked}
            onRoomChange={onRoom}
            placement={navigation.placement}
            onPortal={navigation.onPortal}
            onNearTarget={setTarget}
          />
          <PointerLook />
        </Canvas>
      )}
      <Hud
        locked={locked}
        seed={seed}
        rooms={generated.world?.graph.rooms.length ?? 0}
        preset={initial.preset}
        code={initial.code}
        place={place}
        breadcrumb={breadcrumbOf(
          generated.codeGraph,
          navigation.frames,
          navigation.roomId
        )}
        prompt={promptOf(generated.codeGraph, navigation.frames, target)}
        warnings={generated.warnings}
        error={generated.error}
      />
    </div>
  );
};

export { App };
