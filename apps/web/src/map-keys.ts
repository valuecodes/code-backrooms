// What the map keys do, kept free of React so the rules are tested: M shows
// the local map while walking; Tab shows the world map while walking and
// closes it again whether walking or not; Esc closes it once the pointer is
// free (while walking the browser takes Esc to free the pointer).

type MapKeyAction = "toggle-map" | "toggle-world-map" | "close-world-map";

type MapKeyResult = {
  /** Keep the browser from acting on the key (Tab moves the focus). */
  readonly preventDefault: boolean;
  readonly action: MapKeyAction | null;
};

type MapKeyEvent = { readonly code: string; readonly repeat: boolean };

type MapKeyState = {
  /** The pointer is locked: the player is walking. */
  readonly locked: boolean;
  readonly worldMapOpen: boolean;
};

const mapKeyAction = (
  { code, repeat }: MapKeyEvent,
  { locked, worldMapOpen }: MapKeyState
): MapKeyResult => {
  if (code === "Tab") {
    const ours = locked || worldMapOpen;
    // Held down too, or the focus would move on each repeat.
    return {
      preventDefault: ours,
      action: ours && !repeat ? "toggle-world-map" : null,
    };
  }
  if (repeat) {
    return { preventDefault: false, action: null };
  }
  if (code === "KeyM" && locked) {
    return { preventDefault: false, action: "toggle-map" };
  }
  if (code === "Escape" && !locked && worldMapOpen) {
    return { preventDefault: false, action: "close-world-map" };
  }
  return { preventDefault: false, action: null };
};

export { mapKeyAction };
