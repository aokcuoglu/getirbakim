import "server-only";
import { db } from "@/lib/db";
import { listingEpoch } from "@/modules/store/listing-epoch";
import { setCustomSynonymGroups } from "./query";

/**
 * Admin-managed synonym groups (search_synonyms, #822) in the query parser of this process. An edit bumps the listing
 * epoch (which also drops cached searches), so every process reloads them within about a second; otherwise they are
 * reread every five minutes. A database error keeps the groups loaded last: search never fails over its synonyms.
 */
const refreshMs = 5 * 60_000;
let loadedEpoch = -1, loadedAt = 0;
let loading: Promise<void> | null = null;

export async function ensureCustomSynonyms() {
  const epoch = await listingEpoch();
  if (epoch === loadedEpoch && Date.now() - loadedAt < refreshMs) return;
  loading ??= db.query<{ words: string[] }>("SELECT words FROM search_synonyms ORDER BY id")
    .then(({ rows }) => { setCustomSynonymGroups(rows.map(row => row.words)); loadedEpoch = epoch; })
    .catch(error => console.error("Custom synonyms: load failed; keeping the last groups", error instanceof Error ? error.message : error))
    .finally(() => { loadedAt = Date.now(); loading = null; });
  await loading;
}
