// Next.js incremental cache shared by every app task (AWS: 2-4 Fargate tasks behind one load balancer).
// Without it each task keeps its own cache, so `revalidatePath` from the admin reaches only the task that served
// the request and the other tasks keep serving the old page.
//
// - CACHE_URL set (AWS: rediss://... Valkey, CACHE_AUTH_TOKEN = AUTH token): entries and tag revalidation times live
//   in Valkey, keyed by BUILD_VERSION so a new release never reads a previous build's entries.
// - CACHE_URL set but Valkey unreachable: every read is a miss and writes are skipped. Pages render uncached instead
//   of failing, and no task serves an entry the other tasks may already have revalidated.
// - CACHE_URL unset (local development, single VPS container): an in-process map, the same behaviour as Next's
//   built-in memory cache.
//
// Revalidation follows Next's file-system cache: an entry is dropped when any of its tags (the x-next-cache-tags
// header of a page or route, or a fetch's tags and soft tags) was revalidated after the entry was written.
// `revalidateTag(tag, { expire })` (stale-while-revalidate) is treated as immediate expiry.
import { createClient } from "redis";

const PREFIX = `gb:next:${process.env.BUILD_VERSION || "development"}:`;
const TAGS_KEY = `${PREFIX}tags`;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const COMMAND_TIMEOUT_MS = 500;

// Values hold Buffers (RSC payloads, route bodies, images) and Maps (segment data), which JSON cannot carry as is.
// The replacer reads this[key] because JSON.stringify calls Buffer#toJSON before the replacer sees the value.
function serialize(entry) {
  return JSON.stringify(entry, function replacer(key, value) {
    const original = this[key];
    if (Buffer.isBuffer(original)) return { __gb: "buffer", data: original.toString("base64") };
    if (original instanceof Map) return { __gb: "map", entries: [...original.entries()] };
    return value;
  });
}
function deserialize(text) {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === "object" && value.__gb === "buffer") return Buffer.from(value.data, "base64");
    if (value && typeof value === "object" && value.__gb === "map") return new Map(value.entries);
    return value;
  });
}

function entryTags(value, ctx) {
  const header = value?.headers?.["x-next-cache-tags"];
  const tags = typeof header === "string" ? header.split(",") : [];
  if (value?.kind === "FETCH") tags.push(...(ctx?.tags || []), ...(ctx?.softTags || []));
  return [...new Set(tags.filter(Boolean))];
}
// unstable_cache writes FETCH entries with the revalidate on the value (value.revalidate, one year for `false`), not on
// ctx. The entry must outlive that window so Next can still serve it stale while it refreshes in the background:
// the TTL is twice the revalidate, capped. Entries without any revalidate get the default TTL.
function ttlSeconds(ctx, value) {
  const fetchRevalidate = value?.kind === "FETCH" ? value.revalidate : undefined;
  const seconds = ctx?.cacheControl?.expire ?? ctx?.cacheControl?.revalidate ?? ctx?.revalidate;
  if (seconds === false) return MAX_TTL_SECONDS;
  if (typeof seconds === "number" && seconds > 0) return Math.min(Math.ceil(seconds), MAX_TTL_SECONDS);
  if (typeof fetchRevalidate === "number" && fetchRevalidate > 0) return Math.min(Math.ceil(fetchRevalidate * 2), MAX_TTL_SECONDS);
  return DEFAULT_TTL_SECONDS;
}

let lastErrorLog = 0;
function logError(message, error) {
  // A Valkey outage would otherwise log on every request.
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(`Cache handler: ${message}`, error instanceof Error ? error.message : error);
}

let client;
function valkey() {
  if (!client) {
    client = createClient({
      url: process.env.CACHE_URL,
      password: process.env.CACHE_AUTH_TOKEN || undefined,
      // Fail fast while disconnected instead of queueing requests behind a reconnect.
      disableOfflineQueue: true,
      socket: { connectTimeout: 2_000, reconnectStrategy: retries => Math.min(500 * 2 ** retries, 10_000) },
    });
    client.on("error", error => logError("Valkey error", error));
    client.connect().catch(error => logError("Valkey connect failed", error));
  }
  return client;
}
async function withTimeout(operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("command timed out")), COMMAND_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class ValkeyStore {
  async get(key) {
    const redis = valkey();
    if (!redis.isReady) return null;
    try {
      const text = await withTimeout(() => redis.get(PREFIX + key));
      if (!text) return null;
      const entry = deserialize(text);
      if (entry.tags.length > 0) {
        const times = await withTimeout(() => redis.hmGet(TAGS_KEY, entry.tags));
        if (times.some(time => time !== null && Number(time) > entry.lastModified)) return null;
      }
      return entry;
    } catch (error) {
      logError("read failed", error);
      return null;
    }
  }
  async set(key, entry, ttl) {
    const redis = valkey();
    if (!redis.isReady) return;
    try {
      await withTimeout(() => redis.set(PREFIX + key, serialize(entry), { expiration: { type: "EX", value: ttl } }));
    } catch (error) {
      logError("write failed", error);
    }
  }
  async revalidate(tags, now) {
    const redis = valkey();
    if (!redis.isReady) return;
    try {
      await withTimeout(() => redis.hSet(TAGS_KEY, Object.fromEntries(tags.map(tag => [tag, String(now)]))));
    } catch (error) {
      logError("tag revalidation failed", error);
    }
  }
}

class MemoryStore {
  entries = new Map();
  tags = new Map();
  async get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.entries.delete(key); return null; }
    if (entry.tags.some(tag => (this.tags.get(tag) ?? 0) > entry.lastModified)) return null;
    return entry;
  }
  async set(key, entry, ttl) {
    this.entries.set(key, { ...entry, expiresAt: Date.now() + ttl * 1000 });
  }
  async revalidate(tags, now) {
    for (const tag of tags) this.tags.set(tag, now);
  }
}

const store = process.env.CACHE_URL ? new ValkeyStore() : new MemoryStore();

export default class CacheHandler {
  constructor() {}

  async get(key) {
    const entry = await store.get(key);
    return entry ? { lastModified: entry.lastModified, value: entry.value } : null;
  }

  async set(key, value, ctx) {
    if (value === null) return;
    await store.set(key, { lastModified: Date.now(), tags: entryTags(value, ctx), value }, ttlSeconds(ctx, value));
  }

  async revalidateTag(tags) {
    const list = (typeof tags === "string" ? [tags] : tags).filter(Boolean);
    if (list.length > 0) await store.revalidate(list, Date.now());
  }

  resetRequestCache() {}
}

export const __test__ = { serialize, deserialize, entryTags, ttlSeconds, MemoryStore };
