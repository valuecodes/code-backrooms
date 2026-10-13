import type { Quality } from "@repo/renderer/effects";
import { useSyncExternalStore } from "react";

// The rendering quality: one value for the whole page, kept in localStorage.
// `low` by default: the post-processing chain costs roughly a frame on top
// of the frame, so it is opted into with Q rather than paid by everyone.

const KEY = "quality";

const DEFAULT_QUALITY: Quality = "low";

type QualityStorage = Pick<Storage, "getItem" | "setItem">;

const parseQuality = (raw: string | null): Quality | null =>
  raw === "low" || raw === "high" ? raw : null;

/** The stored quality, or the default when there is none or storage throws. */
const readQuality = (storage: QualityStorage | null): Quality => {
  try {
    return parseQuality(storage?.getItem(KEY) ?? null) ?? DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
};

/** Stores the quality; a full or blocked storage keeps it for this page only. */
const writeQuality = (storage: QualityStorage | null, quality: Quality) => {
  try {
    storage?.setItem(KEY, quality);
  } catch {
    // Nothing to do: the in-memory value still drives the page.
  }
};

const toggleQuality = (quality: Quality): Quality =>
  quality === "high" ? "low" : "high";

/** `localStorage`, or null where even reading it throws (a blocked origin). */
const localStorageOf = (): QualityStorage | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

let current: Quality | null = null;
const listeners = new Set<() => void>();

const getQuality = (): Quality => {
  current ??= readQuality(localStorageOf());
  return current;
};

const setQuality = (quality: Quality) => {
  current = quality;
  writeQuality(localStorageOf(), quality);
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The page's quality, re-rendering on every change. */
const useQuality = (): Quality =>
  useSyncExternalStore(subscribe, getQuality, () => DEFAULT_QUALITY);

export {
  DEFAULT_QUALITY,
  getQuality,
  parseQuality,
  readQuality,
  setQuality,
  toggleQuality,
  useQuality,
  writeQuality,
};
