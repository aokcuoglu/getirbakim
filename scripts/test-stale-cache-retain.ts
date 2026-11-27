// Child process of test-stale-cache.ts (#1461): run with --expose-gc (and --no-async-context-frame where Node has it, which
// gives Node 24 the hooks-based AsyncLocalStorage of Node 22). Prints how many request stores a settled cache entry still
// keeps alive after the requests are over: 0 is the expectation.
import { AsyncLocalStorage } from "node:async_hooks";
import { staleCache } from "../src/lib/stale-cache";
import { sharedLoads, ttlCache } from "../src/lib/ttl-cache";

const requests = new AsyncLocalStorage<{ payload: Uint8Array }>();
const refs: WeakRef<object>[] = [];
const request = <T>(run: () => Promise<T>) => {
  const store = { payload: new Uint8Array(1 << 20) };
  refs.push(new WeakRef(store));
  return requests.run(store, run);
};

const stale = staleCache<string[]>(60_000, 100);
const ttl = ttlCache<string[]>(60_000, 100);
const shared = sharedLoads<string[]>(60_000, 100);
for (let index = 0; index < 20; index++) {
  const key = `k${index}`;
  await request(() => stale(key, async () => [key]));
  await request(() => ttl(key, async () => [key]));
  await request(() => shared(key, async () => [key]));
}
// Reading settled entries from another request must not pin that request either.
for (let index = 0; index < 20; index++) await request(() => stale(`k${index}`, async () => ["unused"]));
const collect = async () => {
  for (let round = 0; round < 5; round++) {
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
await collect();
console.log(`retained=${refs.filter(ref => ref.deref() !== undefined).length} of ${refs.length}`);
