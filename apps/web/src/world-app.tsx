import { Canvas } from "@react-three/fiber";
import { PointerLook } from "@repo/renderer/controls";
import { Effects } from "@repo/renderer/effects";
import { Player } from "@repo/renderer/player";
import { RenderStats } from "@repo/renderer/stats";
import type { RenderSample } from "@repo/renderer/stats";
import { World } from "@repo/renderer/world";
import type { Target } from "@repo/world-generator/interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { choiceDigit } from "~/choice-keys";
import { createFeed } from "~/feed";
import { Hud } from "~/hud";
import { mapKeyAction } from "~/map-keys";
import { EMPTY_VISITS, visit, visitedIn } from "~/map-model";
import { OverviewMap } from "~/overview-map";
import { nextSeed, withSeed } from "~/params";
import { createPoseFeed } from "~/pose-feed";
import { getQuality, setQuality, toggleQuality, useQuality } from "~/quality";
import { SourcePanel } from "~/source-panel";
import { sourceView } from "~/source-view";
import { StatsLine } from "~/stats-line";
import { useAreaWorld, zoneProgress } from "~/use-area-world";
import { useNavigation } from "~/use-navigation";
import { breadcrumbOf, describeRoom, promptOf } from "~/world-from-code";
import { WorldMapOverlay } from "~/world-map-overlay";
import { initial } from "~/world-setup";
import type { WorldSetup } from "~/world-setup";

// Fed from the render loop and read only by the open maps, never by the app.
const feed = createPoseFeed();
// Likewise for the renderer's numbers, read only by the open stats line.
const statsFeed = createFeed<RenderSample>();

const WorldApp = ({ setup }: { readonly setup: WorldSetup }) => {
  const {
    areaLinks,
    code,
    codeGraph,
    label,
    labelOfArea,
    local,
    notices,
    startSeed,
    worldOptions,
  } = setup;
  const [locked, setLocked] = useState(false);
  const [seed, setSeed] = useState(startSeed);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(initial.stats);
  const [visits, setVisits] = useState(EMPTY_VISITS);
  const quality = useQuality();
  // Generated once per seed, then grown an area at a time: it never
  // regenerates while the player moves.
  const generated = useAreaWorld(seed, worldOptions);
  const { ensurePortal, ensureUnit, candidatesOf } = generated;
  // The target a candidate was last picked at (see the key handler).
  const picked = useRef<Target | null>(null);
  const navigation = useNavigation(seed, generated.current);
  const { onRoomChange, back, home, choose, onPortal: stepPortal } = navigation;

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

  // A new seed or a reopened line starts without the last sample, which
  // described another world or an earlier moment.
  useEffect(() => {
    statsFeed.clear();
  }, [seed, statsOpen]);

  // N: next seed (the only thing that regenerates the world), Q: the
  // rendering quality and I: the renderer's numbers, in any pointer state.
  // Backspace and R navigate, E
  // shows the source and M the local map, only while walking, so a free
  // pointer leaves them alone; so do 1 to 9, which pick a candidate at a
  // choice portal (its area is generated first, so the pick lands). Tab
  // shows the world map while walking and, like Esc once the pointer is
  // free, closes it (`map-keys`).
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
      } else if (event.code === "KeyQ") {
        setQuality(toggleQuality(getQuality()));
      } else if (event.code === "KeyI") {
        setStatsOpen((open) => !open);
      } else if (locked && event.code === "Backspace") {
        event.preventDefault();
        back();
      } else if (locked && event.code === "KeyR") {
        home();
      } else if (locked && event.code === "KeyE") {
        setSourceOpen((open) => !open);
      } else if (
        locked &&
        target?.kind === "portal" &&
        picked.current !== target
      ) {
        const digit = choiceDigit(event.code);
        const candidate =
          digit === null ? undefined : candidatesOf(target.portalId)[digit - 1];
        if (candidate !== undefined) {
          // One pick per sighting of the portal: a second key before the
          // teleport is seen would push a second frame for a recursive
          // candidate, whose unit is the one the player is already in. A
          // candidate whose area failed goes nowhere, so it leaves the
          // other keys free.
          if (ensureUnit(candidate)) {
            picked.current = target;
          }
          choose(target.portalId, candidate);
        }
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [
    locked,
    worldMapOpen,
    back,
    home,
    target,
    candidatesOf,
    ensureUnit,
    choose,
  ]);

  // Keep the URL shareable: it always names the seed on screen. Not for a
  // zip or folder: no URL can name those files, and a `?seed` would reload
  // into a random world instead of the landing page.
  useEffect(() => {
    if (seed !== startSeed && !local) {
      globalThis.history.replaceState(
        null,
        "",
        withSeed(globalThis.location.search, seed)
      );
    }
  }, [seed, startSeed, local]);

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
    [codeGraph, sources, roomId]
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
          {statsOpen && <RenderStats onSample={statsFeed.publish} />}
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
          <Effects quality={quality} />
        </Canvas>
      )}
      {locked && mapOpen && generated.world !== null && (
        <OverviewMap
          world={generated.world}
          visited={visitedIn(visits, seed)}
          current={roomId}
          activeUnit={navigation.roomId}
          feed={feed}
        />
      )}
      {locked && sourceOpen && sources !== null && (
        <SourcePanel view={source} />
      )}
      {statsOpen && generated.world !== null && (
        <StatsLine feed={statsFeed} areas={generated.world.areas.length} />
      )}
      <Hud
        locked={locked}
        seed={seed}
        rooms={generated.rooms}
        modules={generated.modules}
        zone={zone}
        lastMs={generated.lastMs}
        preset={initial.preset}
        label={label}
        quality={quality}
        place={place}
        breadcrumb={breadcrumbOf(
          codeGraph,
          navigation.frames,
          navigation.roomId
        )}
        prompt={
          failed === null
            ? promptOf(
                codeGraph,
                navigation.frames,
                target,
                generated.failedUnit
              )
            : `closed · ${failed} could not be laid out`
        }
        warnings={generated.warnings}
        notices={notices}
        error={generated.error}
      />
      {worldMapOpen && generated.world !== null && (
        <WorldMapOverlay
          world={generated.world}
          errors={generated.errors}
          labelOf={labelOfArea}
          links={areaLinks}
          feed={feed}
          activeUnit={navigation.roomId}
          locked={locked}
        />
      )}
    </div>
  );
};

export { WorldApp };
