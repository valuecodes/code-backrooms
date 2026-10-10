import { Canvas } from "@react-three/fiber";
import type { CodeGraph } from "@repo/code-graph";
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";
import type { GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import { mergeAreas } from "@repo/world-generator/areas";
import type { Target } from "@repo/world-generator/interaction";
import { presets } from "@repo/world-generator/presets";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Hud } from "~/hud";
import { EMPTY_VISITS, visit, visitedIn } from "~/map-model";
import { OverviewMap } from "~/overview-map";
import { initialSeed, nextSeed, parseWorldParams, withSeed } from "~/params";
import { createPoseFeed } from "~/pose-feed";
import { SourcePanel } from "~/source-panel";
import { sourceView } from "~/source-view";
import { useNavigation } from "~/use-navigation";
import {
  areasFromCode,
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  sourceSeedOf,
} from "~/world-from-code";

type Generated = {
  readonly world: GeneratedWorld | null;
  /** Modules of a code world, each its own area; one for other worlds. */
  readonly modules: number;
  readonly codeGraph: CodeGraph | null;
  /** Graph connections and portals the layout could not realise, one line each. */
  readonly warnings: readonly string[];
  readonly error: string | null;
};

const initial = parseWorldParams(globalThis.location.search);

// Parsed once: a syntax error in a bundled example does not depend on the
// seed, and it is shown in the HUD rather than thrown through the renderer.
const code = initial.code === null ? null : codeGraphOf(initial.code);

// A code world without `?seed` takes its source's own seed, so the same
// program reloads into the same world; `?seed` and N override it.
const startSeed = initialSeed(
  initial,
  initial.code === null ? null : sourceSeedOf(initial.code)
);

// Fed from the render loop and read only by the open map, never by the app.
const feed = createPoseFeed();

const generate = (
  seed: number
): { readonly world: GeneratedWorld; readonly modules: number } => {
  const codeGraph = code?.codeGraph ?? null;
  if (codeGraph !== null) {
    const areas = areasFromCode(codeGraph, seed);
    // The entrance is an area but not a module.
    return { world: mergeAreas(areas), modules: codeGraph.modules.length };
  }
  const world = generateWorld({
    seed,
    roomCount: initial.rooms,
    graph: initial.preset === null ? undefined : presets[initial.preset],
  });
  return { world, modules: 1 };
};

/**
 * Builds the world once per seed: it never regenerates while the player moves.
 * Generation errors (an unplaceable graph) are shown, not thrown.
 */
const useGeneratedWorld = (seed: number): Generated =>
  useMemo(() => {
    const codeGraph = code?.codeGraph ?? null;
    if (code !== null && code.error !== null) {
      return {
        world: null,
        modules: 0,
        codeGraph,
        warnings: [],
        error: code.error,
      };
    }
    try {
      const { world, modules } = generate(seed);
      // Shown in the HUD, so the console stays quiet.
      const warnings = [
        ...world.layout.unresolved.map(
          ({ from, to }) => `${from} -> ${to} could not be laid out`
        ),
        ...world.layout.unplacedPortals.map(
          ({ id }) => `${id} has no wall space`
        ),
      ];
      return { world, modules, codeGraph, warnings, error: null };
    } catch (error) {
      return {
        world: null,
        modules: 0,
        codeGraph,
        warnings: [],
        error: String(error),
      };
    }
  }, [seed]);

const App = () => {
  const [locked, setLocked] = useState(false);
  const [seed, setSeed] = useState(startSeed);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [visits, setVisits] = useState(EMPTY_VISITS);
  const generated = useGeneratedWorld(seed);
  const built = generated.world?.built ?? null;
  const navigation = useNavigation(generated.world);
  const { onRoomChange, back, home } = navigation;

  const onRoom = useCallback(
    (id: string | null) => {
      setRoomId(id);
      setVisits((previous) => visit(previous, built, id));
      onRoomChange(id);
    },
    [built, onRoomChange]
  );

  // N: next seed (the only thing that regenerates the world). Backspace and
  // R navigate, E shows the source and M or Tab the map, only while walking,
  // so a free pointer leaves them alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+R and friends belong to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // Tab would otherwise move the focus, held down too.
      if (locked && event.code === "Tab") {
        event.preventDefault();
      }
      if (event.repeat) {
        return;
      }
      if (event.code === "KeyN") {
        setSeed(nextSeed);
      } else if (locked && event.code === "Backspace") {
        event.preventDefault();
        back();
      } else if (locked && event.code === "KeyR") {
        home();
      } else if (locked && event.code === "KeyE") {
        setSourceOpen((open) => !open);
      } else if (locked && (event.code === "KeyM" || event.code === "Tab")) {
        setMapOpen((open) => !open);
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [locked, back, home]);

  // Keep the URL shareable: it always names the seed on screen.
  useEffect(() => {
    if (seed !== startSeed) {
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
  const sources = code?.error === null ? code.sources : null;
  const source = useMemo(
    () =>
      sources === null
        ? null
        : sourceView(generated.codeGraph, sources, roomId),
    [generated.codeGraph, sources, roomId]
  );

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
            onMove={feed.publish}
          />
          <PointerLook />
        </Canvas>
      )}
      {locked && mapOpen && built !== null && (
        <OverviewMap
          world={built}
          visited={visitedIn(visits, built)}
          current={roomId}
          feed={feed}
        />
      )}
      {locked && sourceOpen && sources !== null && (
        <SourcePanel view={source} />
      )}
      <Hud
        locked={locked}
        seed={seed}
        rooms={generated.world?.graph.rooms.length ?? 0}
        modules={generated.modules}
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
