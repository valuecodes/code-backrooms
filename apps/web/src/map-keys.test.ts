import { describe, expect, it } from "vitest";

import { mapKeyAction } from "./map-keys";

const press = (code: string, repeat = false) => ({ code, repeat });

const walking = { locked: true, worldMapOpen: false };
const walkingWithMap = { locked: true, worldMapOpen: true };
const free = { locked: false, worldMapOpen: false };
const freeWithMap = { locked: false, worldMapOpen: true };

describe("mapKeyAction", () => {
  it("toggles the local map with M only while walking", () => {
    expect(mapKeyAction(press("KeyM"), walking)).toEqual({
      preventDefault: false,
      action: "toggle-map",
    });
    expect(mapKeyAction(press("KeyM"), walkingWithMap).action).toBe(
      "toggle-map"
    );
    expect(mapKeyAction(press("KeyM"), free).action).toBeNull();
  });

  it("opens the world map with Tab while walking, not M", () => {
    expect(mapKeyAction(press("Tab"), walking)).toEqual({
      preventDefault: true,
      action: "toggle-world-map",
    });
  });

  it("closes the world map with Tab whether walking or not", () => {
    expect(mapKeyAction(press("Tab"), walkingWithMap).action).toBe(
      "toggle-world-map"
    );
    expect(mapKeyAction(press("Tab"), freeWithMap)).toEqual({
      preventDefault: true,
      action: "toggle-world-map",
    });
  });

  it("leaves Tab to the browser with the pointer free and the map shut", () => {
    expect(mapKeyAction(press("Tab"), free)).toEqual({
      preventDefault: false,
      action: null,
    });
  });

  it("keeps a held Tab from moving the focus without toggling again", () => {
    expect(mapKeyAction(press("Tab", true), walking)).toEqual({
      preventDefault: true,
      action: null,
    });
    expect(mapKeyAction(press("Tab", true), free).preventDefault).toBe(false);
  });

  it("closes the world map with Esc once the pointer is free", () => {
    expect(mapKeyAction(press("Escape"), freeWithMap)).toEqual({
      preventDefault: false,
      action: "close-world-map",
    });
    // While walking the browser takes Esc to free the pointer.
    expect(mapKeyAction(press("Escape"), walkingWithMap).action).toBeNull();
    expect(mapKeyAction(press("Escape"), free).action).toBeNull();
  });

  it("ignores repeats and other keys", () => {
    expect(mapKeyAction(press("KeyM", true), walking).action).toBeNull();
    expect(mapKeyAction(press("Escape", true), freeWithMap).action).toBeNull();
    expect(mapKeyAction(press("KeyW"), walking)).toEqual({
      preventDefault: false,
      action: null,
    });
  });
});
