import type { Placement } from "@repo/types";

/**
 * Where the player is, handed from the render loop to the overview map
 * without rendering the app (which would re-render the whole scene): the
 * Player publishes, the open map subscribes through `useSyncExternalStore`.
 */
type PoseFeed = {
  readonly publish: (pose: Placement) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** The latest pose, the same object until the next publish. */
  readonly get: () => Placement | null;
};

const createPoseFeed = (): PoseFeed => {
  let latest: Placement | null = null;
  const listeners = new Set<() => void>();
  return {
    publish: (pose) => {
      latest = pose;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => latest,
  };
};

export { createPoseFeed };
export type { PoseFeed };
