import { PointerLockControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type MovementKeys = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
};

type Action = keyof MovementKeys;

/** `KeyboardEvent.code` values, so the bindings follow physical key positions. */
const KEY_BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
};

const released = (): MovementKeys => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
});

/**
 * Tracks held movement keys in a ref, so reading them in the render loop never
 * re-renders. Everything is released on blur or tab switch: a key let go in
 * another window would otherwise stay stuck down.
 */
const useMovementKeys = (): RefObject<MovementKeys> => {
  const keys = useRef<MovementKeys>(released());
  useEffect(() => {
    const set = (code: string, pressed: boolean): boolean => {
      const action = KEY_BINDINGS[code];
      if (action === undefined) {
        return false;
      }
      keys.current[action] = pressed;
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (set(event.code, true)) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      set(event.code, false);
    };
    const releaseAll = () => {
      keys.current = released();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        releaseAll();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup", onKeyUp);
    globalThis.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return keys;
};

type PointerLookProps = {
  readonly onLock: () => void;
  readonly onUnlock: () => void;
};

/**
 * Mouse look through the Pointer Lock API. A click anywhere locks the pointer;
 * the browser releases it on Esc.
 */
const PointerLook = ({ onLock, onUnlock }: PointerLookProps) => (
  <PointerLockControls makeDefault onLock={onLock} onUnlock={onUnlock} />
);

export { PointerLook, useMovementKeys };
