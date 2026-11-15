import { siteUrl } from "@/lib/site";
import { absoluteUrl } from "./paths";

/**
 * IndexNow (#645): the product pages whose indexable content changed since the last report, sent once a day to the
 * shared endpoint, which hands them to the participating engines (Bing, Yandex…). Pure helpers; the database side is
 * indexnow.server.ts, the command scripts/indexnow.ts, the key file src/app/api/indexnow/[key]/route.ts (docs/indexnow.md).
 */
export type IndexNowConfig = { key: string; host: string; keyLocation: string; endpoint: string };
type Env = Record<string, string | undefined>;

const keyPattern = /^[A-Za-z0-9-]{8,128}$/;

/** The protocol's settings, or null without a key. A malformed key throws: it could never be verified. */
export function indexNowConfig(env: Env = process.env): IndexNowConfig | null {
  const key = env.INDEXNOW_KEY?.trim();
  if (!key) return null;
  if (!keyPattern.test(key)) throw new Error("INDEXNOW_KEY must be 8-128 characters of a-z, A-Z, 0-9 or '-'");
  return { key, host: new URL(siteUrl).host, keyLocation: absoluteUrl(siteUrl, `/${key}.txt`), endpoint: "https://api.indexnow.org/indexnow" };
}

/** Only production with a key reports; elsewhere the pages are not the public site's. */
export function indexNowSendable(env: Env = process.env): boolean {
  return env.APP_ENV === "production" && Boolean(env.INDEXNOW_KEY?.trim());
}

/** The protocol's limit of URLs per request. */
export const indexNowBatchLimit = 10_000;

export function batches<T>(items: readonly T[], size = indexNowBatchLimit): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

export type IndexNowRow = { id: string; path: string; fingerprint: string };
export type ChunkDiff = { added: IndexNowRow[]; changed: IndexNowRow[]; removed: IndexNowRow[]; urls: string[] };

/**
 * The difference between the indexable pages (`current`) and the last reported state (`known`): new pages, pages whose
 * content or address changed, and pages that left the index. A moved page reports its old address too, so the engine
 * drops it. `urls` are absolute and unique.
 */
export function diffChunk(current: readonly IndexNowRow[], known: readonly IndexNowRow[]): ChunkDiff {
  const knownById = new Map(known.map(row => [row.id, row]));
  const currentIds = new Set(current.map(row => row.id));
  const added: IndexNowRow[] = [], changed: IndexNowRow[] = [];
  const paths = new Set<string>();
  for (const row of current) {
    const previous = knownById.get(row.id);
    if (!previous) { added.push(row); paths.add(row.path); continue; }
    if (previous.fingerprint === row.fingerprint && previous.path === row.path) continue;
    changed.push(row);
    paths.add(row.path);
    if (previous.path !== row.path) paths.add(previous.path);
  }
  const removed = known.filter(row => !currentIds.has(row.id));
  for (const row of removed) paths.add(row.path);
  return { added, changed, removed, urls: [...paths].map(path => absoluteUrl(siteUrl, path)) };
}

/**
 * True when more than half of a chunk's known pages would leave the index at once: a wrong environment or a half-loaded
 * catalog must not report hundreds of thousands of removals. A deliberate mass removal is accepted with `--seed`.
 */
export function removalAnomaly(knownCount: number, removedCount: number): boolean {
  return knownCount > 100 && removedCount > knownCount / 2;
}

export type SubmitResult = { ok: boolean; status: number | null; requests: number; error?: string };
type SubmitOptions = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; attempts?: number };

const retryDelaysMs = [5_000, 30_000, 120_000];
const maxRetryAfterMs = 600_000;

function retryAfterMs(header: string | null, attempt: number): number {
  const fallback = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
  if (!header) return fallback;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, maxRetryAfterMs) : fallback;
}

/**
 * One request of up to 10,000 URLs. 200 and 202 succeed (202: the key is not verified yet). 429, 5xx and network
 * errors are retried (Retry-After when given, else 5 / 30 / 120 s); 400, 403, 422 and other answers are final. Never
 * throws.
 */
export async function submitUrls(config: IndexNowConfig, urls: readonly string[], { fetch, sleep, attempts = 3 }: SubmitOptions): Promise<SubmitResult> {
  const body = JSON.stringify({ host: config.host, key: config.key, keyLocation: config.keyLocation, urlList: urls });
  let status: number | null = null, error: string | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let retryAfter: string | null = null;
    try {
      const response = await fetch(config.endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
      status = response.status;
      if (status === 200 || status === 202) return { ok: true, status, requests: attempt + 1 };
      error = `HTTP ${status}`;
      if (status !== 429 && status < 500) return { ok: false, status, requests: attempt + 1, error };
      retryAfter = response.headers.get("retry-after");
    } catch (failure) {
      status = null;
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (attempt + 1 < attempts) await sleep(retryAfterMs(retryAfter, attempt));
  }
  return { ok: false, status, requests: attempts, error };
}
