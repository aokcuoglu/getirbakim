import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { StaleCacheStore } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";

/**
 * The shared, persisted level of the storefront listing caches (#957, db/storefront-catalog.sql storefront_listing_cache).
 * A new app container or a restart reads the counts, page ids and facets another process already computed instead of
 * scanning the catalog again (0.5-3 s each). Rows carry the listing epoch they were loaded under (#585): staleCache
 * adopts only a current one, and an older write never replaces a newer row. The key hash covers `version` (bump it when
 * the stored value's shape or meaning changes) and the storefront's supplier companies. LISTING_CACHE_PERSIST=0 turns
 * the level off; a missing table (setup not run yet) turns it off for five minutes. Errors are logged (throttled) and
 * count as a miss: the caller loads the value itself.
 */
const maxBytes = 256 * 1024;
const pruneEvery = 200;
const missingTableBackoffMs = 5 * 60 * 1000;
let disabledUntil = 0, writes = 0, lastErrorLog = 0;

function logError(message: string, error: unknown) {
  // A database outage would otherwise log on every request.
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(`Listing cache store: ${message}`, error instanceof Error ? error.message : error);
}
function failed(action: string, error: unknown) {
  if ((error as { code?: string } | null)?.code === "42P01") {
    disabledUntil = Date.now() + missingTableBackoffMs;
    logError(`${action} failed: storefront_listing_cache is missing; the persisted level is off for 5 minutes`, error);
  } else logError(`${action} failed; loading instead`, error);
}
const enabled = () => process.env.LISTING_CACHE_PERSIST !== "0" && Date.now() >= disabledUntil;

export function listingCacheStore<T>(namespace: string, version: number): StaleCacheStore<T> {
  const hash = (key: string) => createHash("sha256").update(JSON.stringify([version, storefrontCompanies(), key])).digest("hex");
  return {
    async read(key) {
      if (!enabled()) return null;
      try {
        const { rows } = await db.query<{ value: T; epoch: string; age_ms: string }>(
          `SELECT value,epoch::text AS epoch,(extract(epoch FROM now()-computed_at)*1000)::bigint::text AS age_ms
           FROM storefront_listing_cache WHERE namespace=$1 AND key_hash=$2`, [namespace, hash(key)]);
        return rows[0] ? { value: rows[0].value, epoch: Number(rows[0].epoch), ageMs: Number(rows[0].age_ms) } : null;
      } catch (error) {
        failed("read", error);
        return null;
      }
    },
    async write(key, value, epoch) {
      if (!enabled()) return;
      const json = JSON.stringify(value);
      if (json === undefined || Buffer.byteLength(json) > maxBytes) return;
      try {
        await db.query(`INSERT INTO storefront_listing_cache(namespace,key_hash,epoch,value) VALUES($1,$2,$3,$4::jsonb)
          ON CONFLICT (namespace,key_hash) DO UPDATE SET value=excluded.value,epoch=excluded.epoch,computed_at=now()
          WHERE excluded.epoch>=storefront_listing_cache.epoch`, [namespace, hash(key), epoch, json]);
        // Keys nobody reads any more (a removed category, an old version) are dropped now and then.
        if (++writes % pruneEvery === 0) await db.query("DELETE FROM storefront_listing_cache WHERE computed_at<now()-interval '2 days'");
      } catch (error) {
        failed("write", error);
      }
    },
  };
}
