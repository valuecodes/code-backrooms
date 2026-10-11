import { Canvas } from "@react-three/fiber";
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";
import type { Target } from "@repo/world-generator/interaction";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Hud } from "~/hud";
import { mapKeyAction } from "~/map-keys";
import { EMPTY_VISITS, visit, visitedIn } from "~/map-model";
import { OverviewMap } from "~/overview-map";
import { nextSeed, withSeed } from "~/params";
import { createPoseFeed } from "~/pose-feed";
import { SourcePanel } from "~/source-panel";
import { sourceView } from "~/source-view";
import { useAreaWorld, zoneProgress } from "~/use-area-world";
import { useNavigation } from "~/use-navigation";
import { breadcrumbOf, describeRoom, promptOf } from "~/world-from-code";
import { WorldMapOverlay } from "~/world-map-overlay";
import {
  areaLinks,
  code,
  codeGraph,
  initial,
  labelOfArea,
  startSeed,
  worldOptions,
} from "~/world-setup";

// Fed from the render loop and read only by the open maps, never by the app.
const feed = createPoseFeed();

const App = () => {
  const [locked, setLocked] = useState(false);
  const [seed, setSeed] = useState(startSeed);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [visits, setVisits] = useState(EMPTY_VISITS);
  // Generated once per seed, then grown an area at a time: it never
  // regenerates while the player moves.
  const generated = useAreaWorld(seed, worldOptions);
  const { ensurePortal } = generated;
  const navigation = useNavigation(seed, generated.current);
  const { onRoomChange, back, home, onPortal: stepPortal } = navigation;

  const onRoom = useCallback(
    (id: string | null) => {
      setRoomId(id);
      setVisits((previous) => visit(previous, seed, id));
      onRoomChange(id);
    },
    [seed, onRoomChange]
  );

  // A portal entered before its far side was generated: generate it first,
  // so the step lands there.
  const onPortal = useCallback(
    (portalId: string) => {
      ensurePortal(portalId);
      stepPortal(portalId);
    },
    [ensurePortal, stepPortal]
  );

  // The portal in front of the player leads into an area not generated yet:
  // generate it now, before the player steps in. Also run when the world
  // changes, as a target kept across a new seed reports no change.
  useEffect(() => {
    if (target?.kind === "portal") {
      ensurePortal(target.portalId);
    }
  }, [target, ensurePortal, generated.world]);

  // N: next seed (the only thing that regenerates the world). Backspace and
  // R navigate, E shows the source and M the local map, only while walking,
  // so a free pointer leaves them alone. Tab shows the world map while
  // walking and, like Esc once the pointer is free, closes it (`map-keys`).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+R and friends belong to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const map = mapKeyAction(event, { locked, worldMapOpen });
      if (map.preventDefault) {
        event.preventDefault();
      }
      if (map.action === "toggle-map") {
        setMapOpen((open) => !open);
      } else if (map.action === "toggle-world-map") {
        setWorldMapOpen((open) => !open);
      } else if (map.action === "close-world-map") {
        setWorldMapOpen(false);
      }
      if (event.repeat || map.action !== null) {
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
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [locked, worldMapOpen, back, home]);

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

  const place = roomId === null ? null : describeRoom(codeGraph, roomId);
  const sources = code?.error === null ? code.sources : null;
  const source = useMemo(
    () => (sources === null ? null : sourceView(codeGraph, sources, roomId)),
    [sources, roomId]
  );
  const failed =
    target?.kind === "portal" ? generated.failedArea(target.portalId) : null;
  // A corridor's zone is found by scanning layouts: once per room or world.
  const zone = useMemo(
    () =>
      generated.world === null ? null : zoneProgress(generated.world, roomId),
    [generated.world, roomId]
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
          <World world={generated.world} />
          <Player
            world={generated.world}
            enabled={locked}
            onRoomChange={onRoom}
            placement={navigation.placement}
            onPortal={onPortal}
            onNearTarget={setTarget}
            onMove={feed.publish}
          />
          <PointerLook />
        </Canvas>
      )}
      {locked && mapOpen && generated.world !== null && (
        <OverviewMap
          world={generated.world}
          visited={visitedIn(visits, seed)}
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
        rooms={generated.rooms}
        modules={generated.modules}
        zone={zone}
        lastMs={generated.lastMs}
        preset={initial.preset}
        code={initial.code}
        place={place}
        breadcrumb={breadcrumbOf(
          codeGraph,
          navigation.frames,
          navigation.roomId
        )}
        prompt={
          failed === null
            ? promptOf(codeGraph, navigation.frames, target)
            : `closed · ${failed} could not be laid out`
        }
        warnings={generated.warnings}
        error={generated.error}
      />
      {worldMapOpen && generated.world !== null && (
        <WorldMapOverlay
          world={generated.world}
          errors={generated.errors}
          labelOf={labelOfArea}
          links={areaLinks}
          feed={feed}
        />
      )}
    </div>
  );
};

export { App };
