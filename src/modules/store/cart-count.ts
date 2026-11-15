/**
 * The header's cart quantity as a tiny client store. Add-to-cart actions return the new total instead of
 * revalidating the layout (which re-rendered the whole page and wiped the client router cache), and other
 * tabs follow through a BroadcastChannel. Server renders seed it with their render time: a seed is adopted
 * only when its stamp is newer than the last seed and not older than the last set() (minus a small tolerance
 * for clock skew between the server and the browser), so an older render cannot override a fresher value.
 */
export type CartCountStore = {
  seed(count: number, stamp: number): void;
  set(count: number): void;
  get(): number | null;
  subscribe(listener: () => void): () => void;
};

/** How far a server render may lag behind the browser clock and still override a set() value. */
export const seedClockTolerance = 2000;

export function createCartCount(channelName?: string, now: () => number = Date.now): CartCountStore {
  let value: number | null = null;
  let lastStamp: number | null = null;
  let lastSetAt: number | null = null;
  let channel: BroadcastChannel | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const write = (count: number) => {
    if (value === count) return;
    value = count;
    notify();
  };
  const openChannel = () => {
    if (channel || !channelName || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === "number" && Number.isInteger(event.data) && event.data >= 0) write(event.data);
    };
  };
  return {
    seed(count, stamp) {
      if (lastStamp !== null && stamp <= lastStamp) return;
      if (lastSetAt !== null && stamp < lastSetAt - seedClockTolerance) return;
      lastStamp = stamp;
      write(count);
    },
    set(count) {
      lastSetAt = now();
      write(count);
      channel?.postMessage(count);
    },
    get: () => value,
    subscribe(listener) {
      openChannel();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const cartCount = createCartCount("gb-cart-count");
