import type { Teleport } from "@repo/renderer/player";
import type { GeneratedWorld } from "@repo/types";
import { createNavigator } from "@repo/world-generator/navigation";
import type {
  Frame,
  NavigationEvent,
  NavigationState,
  Navigator,
} from "@repo/world-generator/navigation";
import { useCallback, useState } from "react";

type Session = {
  /** The seed of the world this session belongs to; another starts over. */
  readonly seed: number;
  readonly nav: NavigationState;
  readonly placement: Teleport | null;
};

type Navigation = {
  readonly frames: readonly Frame[];
  /** The unit of the last room that was not a corridor, or null. */
  readonly roomId: string | null;
  /** Hand this to the Player; a new object means "put the player here". */
  readonly placement: Teleport | null;
  readonly onRoomChange: (roomId: string | null) => void;
  readonly onPortal: (portalId: string) => void;
  readonly back: () => void;
  readonly home: () => void;
};

const EMPTY: NavigationState = { frames: [], roomId: null };

const fresh = (seed: number): Session => ({
  seed,
  nav: EMPTY,
  placement: null,
});

/** One navigator per world object: a world that grew gets a new one. */
const navigators = new WeakMap<GeneratedWorld, Navigator>();

const navigatorOf = (world: GeneratedWorld): Navigator => {
  const known = navigators.get(world);
  if (known !== undefined) {
    return known;
  }
  const created = createNavigator(world);
  navigators.set(world, created);
  return created;
};

/**
 * The exploration stack for the world of `seed`. Events arrive from the
 * render loop and from key handlers, so each one steps from the state React
 * holds at that moment (a functional update), never from a closure, against
 * the world `current` returns at that moment: an area joined in a moment
 * before (a portal entered into it) is already there. Areas never move, so
 * the frames stay valid while the world grows; only a new seed starts over.
 */
const useNavigation = (
  seed: number,
  current: () => GeneratedWorld | null
): Navigation => {
  const [saved, setSaved] = useState<Session>(() => fresh(seed));
  const session = saved.seed === seed ? saved : fresh(seed);

  const step = useCallback(
    (event: NavigationEvent) => {
      const world = current();
      if (world === null) {
        return;
      }
      const navigator = navigatorOf(world);
      setSaved((previous) => {
        const base = previous.seed === seed ? previous : fresh(seed);
        const { state, teleport } = navigator.step(base.nav, event);
        if (state === base.nav && teleport === null) {
          return base;
        }
        return {
          seed,
          nav: state,
          placement:
            teleport === null
              ? base.placement
              : { ...teleport, nonce: (base.placement?.nonce ?? 0) + 1 },
        };
      });
    },
    [seed, current]
  );

  return {
    frames: session.nav.frames,
    roomId: session.nav.roomId,
    placement: session.placement,
    onRoomChange: useCallback(
      (roomId: string | null) => step({ type: "room", roomId }),
      [step]
    ),
    onPortal: useCallback(
      (portalId: string) => step({ type: "portal", portalId }),
      [step]
    ),
    back: useCallback(() => step({ type: "back" }), [step]),
    home: useCallback(() => step({ type: "home" }), [step]),
  };
};

export { useNavigation };
