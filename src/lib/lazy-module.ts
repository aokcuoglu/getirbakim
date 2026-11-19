import { useSyncExternalStore } from "react";

export type LazyModule<T> = {
  /** Starts the download (once per page load); a failed one is forgotten, so the next call asks again. */
  preload: () => Promise<T>;
  /** The module once loaded, `null` before (and always on the server); re-renders the caller when it arrives. */
  use: () => T | null;
};

/**
 * A client module fetched on first intent (hover, focus or click) instead of with the page (#1017). Unlike `next/dynamic`,
 * the caller keeps rendering its own trigger while the chunk loads, so focus stays where it is and an early click only waits.
 */
export function lazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  let promise: Promise<T> | null = null;
  let loaded: T | null = null;
  const listeners = new Set<() => void>();

  function preload() {
    if (!promise) {
      promise = load().then(module => {
        loaded = module;
        for (const listener of listeners) listener();
        return module;
      }, error => {
        promise = null;
        throw error;
      });
      // Hover and focus handlers drop the promise: a failed download must not surface as an unhandled rejection.
      promise.catch(() => {});
    }
    return promise;
  }

  const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
  const snapshot = () => loaded;
  const serverSnapshot = () => null;

  return { preload, use: () => useSyncExternalStore(subscribe, snapshot, serverSnapshot) };
}
