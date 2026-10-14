/**
 * A value handed from the render loop to the overlays without rendering the
 * app (which would re-render the whole scene): the loop publishes, an open
 * overlay subscribes through `useSyncExternalStore`.
 */
type Feed<T> = {
  readonly publish: (value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** The latest value, the same object until the next publish. */
  readonly get: () => T | null;
  /** Forgets the latest value, so a stale one is never shown. */
  readonly clear: () => void;
};

const createFeed = <T>(): Feed<T> => {
  let latest: T | null = null;
  const listeners = new Set<() => void>();
  const set = (value: T | null) => {
    latest = value;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    publish: set,
    clear: () => set(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => latest,
  };
};

export { createFeed };
export type { Feed };
