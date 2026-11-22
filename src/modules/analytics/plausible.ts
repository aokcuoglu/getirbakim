import { clientEvidence } from "@/lib/client-address";
import { cleanPageLocation } from "@/modules/analytics/events";

export const MAX_EVENT_BYTES = 4096;
const FAILURE_BACKOFF_MS = 60_000;
// Keys the Plausible tracker sends (n name, u url, d domain, r referrer, w width, h hash mode, p props, i revenue, $ revenue, e/sd/v/m scroll depth, version, meta).
const trackerKeys = new Set(["n", "u", "r", "w", "h", "p", "i", "$", "e", "sd", "v", "m"]);
const localHost = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const idSegment = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,}|[0-9a-f]{20,})$/i;
// Customer pages whose first segment after the area is an order or account record.
const privateArea = /^\/(?:siparis|siparisler|hesap|garaj|sepet|siparis-olustur)(?:\/|$)/;

/** Reads at most `limit` bytes of a request body; null when it is longer, so a chunked body cannot bypass the cap. */
export async function readCapped(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Record ids (UUIDs, long numbers or hex) in customer-page paths become `:id`; slugs on catalogue pages stay. */
function anonymousPath(pathname: string) {
  if (!privateArea.test(pathname)) return pathname;
  return pathname.split("/").map(segment => idSegment.test(segment) ? ":id" : segment).join("/");
}
const SCRIPT_TTL_MS = 60 * 60 * 1000;
// Pages whose address is private to one visitor or one operator never reach the statistics.
const privatePath = /^\/(?:yonetim(?:\/|$)|sifre-yenile\/baglanti(?:\/|$)|e-posta-dogrula\/baglanti(?:\/|$)|siparis\/[^/]+\/erisim(?:\/|$))/;
const secretParams = ["t", "token"];

function cleaned(value: string) {
  const location = cleanPageLocation(value);
  try {
    const parsed = new URL(location);
    for (const key of secretParams) parsed.searchParams.delete(key);
    parsed.pathname = anonymousPath(parsed.pathname);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The body and headers to send upstream for one tracker event, or null when it must be dropped. The domain is forced, the
 * address loses its `next` and token parameters, /yonetim and token links are never recorded, and the only client hint passed
 * on is the single resolved IP (Plausible hashes it with its daily salt and does not store it).
 */
export function forwardedEvent(body: string, headers: Headers, domain: string, siteHost: string): { body: string; headers: Record<string, string> } | null {
  if (Buffer.byteLength(body) > MAX_EVENT_BYTES) return null;
  let event: unknown;
  try { event = JSON.parse(body); } catch { return null; }
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (typeof record.n !== "string" || typeof record.u !== "string") return null;
  const page = cleaned(record.u);
  if (!page || privatePath.test(page.pathname)) return null;
  if (page.host !== siteHost && !localHost.test(page.host)) return null;
  const out: Record<string, unknown> = { d: domain, u: page.toString() };
  for (const [key, value] of Object.entries(record)) if (trackerKeys.has(key) && key !== "u") out[key] = value;
  if (typeof record.r === "string") {
    const referrer = cleaned(record.r);
    out.r = referrer ? (referrer.host === page.host ? referrer.toString() : record.r) : null;
  }
  const upstream: Record<string, string> = { "Content-Type": "application/json" };
  const userAgent = headers.get("user-agent");
  if (userAgent) upstream["User-Agent"] = userAgent;
  const { ip } = clientEvidence(headers);
  if (ip) upstream["X-Forwarded-For"] = ip;
  return { body: JSON.stringify(out), headers: upstream };
}

type Cached = { body: string; fetchedAt: number };
let cached: Cached | null = null;
let failedAt: number | null = null;
let inFlight: Promise<string | null> | null = null;

/** Test hook: forget the module-level state. */
export function resetScriptCache() { cached = null; failedAt = null; inFlight = null; }

/**
 * The tracker script, refreshed hourly in this process (the route's own cache; the CDN does not cache /stats). Concurrent
 * callers share one fetch; after a failure the last good copy (or null) is served for a minute without refetching.
 */
export async function scriptCache(fetcher: () => Promise<string>, now: number = Date.now()): Promise<string | null> {
  if (cached && now - cached.fetchedAt < SCRIPT_TTL_MS) return cached.body;
  if (failedAt !== null && now - failedAt < FAILURE_BACKOFF_MS) return cached?.body ?? null;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const body = await fetcher();
      cached = { body, fetchedAt: now };
      failedAt = null;
      return body;
    } catch {
      failedAt = now;
      return cached?.body ?? null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let lastWarn = 0;
/** At most one warning a minute, so a down Plausible does not flood the logs. */
export function warnOncePerMinute(message: string, now: number = Date.now()) {
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn(message);
}
