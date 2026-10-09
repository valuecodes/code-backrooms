import type { Teleport } from "@repo/renderer/player";
import type { GeneratedWorld } from "@repo/types";
import { createNavigator } from "@repo/world-generator/navigation";
import type {
  Frame,
  NavigationEvent,
  NavigationState,
  Navigator,
} from "@repo/world-generator/navigation";
import { useCallback, useMemo, useState } from "react";

type Session = {
  /** The navigator this session belongs to; another world starts over. */
  readonly navigator: Navigator | null;
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

const fresh = (navigator: Navigator | null): Session => ({
  navigator,
  nav: navigator?.initial ?? EMPTY,
  placement: null,
});

/**
 * The exploration stack for a world. Events arrive from the render loop and
 * from key handlers, so each one steps from the state React holds at that
 * moment (a functional update), never from a closure. A session made for
 * another world is ignored, which is how a new seed starts over.
 */
const useNavigation = (world: GeneratedWorld | null): Navigation => {
  const navigator = useMemo(
    () => (world === null ? null : createNavigator(world)),
    [world]
  );
  const [saved, setSaved] = useState<Session>(() => fresh(navigator));
  const session = saved.navigator === navigator ? saved : fresh(navigator);

  const step = useCallback(
    (event: NavigationEvent) => {
      if (navigator === null) {
        return;
      }
      setSaved((previous) => {
        const base =
          previous.navigator === navigator ? previous : fresh(navigator);
        const { state, teleport } = navigator.step(base.nav, event);
        if (state === base.nav && teleport === null) {
          return base;
        }
        return {
          navigator,
          nav: state,
          placement:
            teleport === null
              ? base.placement
              : { ...teleport, nonce: (base.placement?.nonce ?? 0) + 1 },
        };
      });
    },
    [navigator]
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
