import { clientEvidence } from "@/lib/client-address";
import { cleanPageLocation } from "@/modules/analytics/events";

const MAX_BODY_BYTES = 4096;
const SCRIPT_TTL_MS = 60 * 60 * 1000;
// Pages whose address is private to one visitor or one operator never reach the statistics.
const privatePath = /^\/(?:yonetim(?:\/|$)|sifre-yenile\/baglanti(?:\/|$)|e-posta-dogrula\/baglanti(?:\/|$)|siparis\/[^/]+\/erisim(?:\/|$))/;
const secretParams = ["t", "token"];

function cleaned(value: string) {
  const location = cleanPageLocation(value);
  try {
    const parsed = new URL(location);
    for (const key of secretParams) parsed.searchParams.delete(key);
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
export function forwardedEvent(body: string, headers: Headers, domain: string): { body: string; headers: Record<string, string> } | null {
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
  let event: unknown;
  try { event = JSON.parse(body); } catch { return null; }
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (typeof record.n !== "string" || typeof record.u !== "string") return null;
  const page = cleaned(record.u);
  if (!page || privatePath.test(page.pathname)) return null;
  const out: Record<string, unknown> = { ...record, d: domain, u: page.toString() };
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

/** Test hook: forget the module-level copy. */
export function resetScriptCache() { cached = null; }

/** The tracker script, refreshed hourly; an upstream failure serves the last good copy, or null when there is none. */
export async function scriptCache(fetcher: () => Promise<string>, now: number = Date.now()): Promise<string | null> {
  if (cached && now - cached.fetchedAt < SCRIPT_TTL_MS) return cached.body;
  try {
    const body = await fetcher();
    cached = { body, fetchedAt: now };
    return body;
  } catch {
    return cached?.body ?? null;
  }
}

let lastWarn = 0;
/** At most one warning a minute, so a down Plausible does not flood the logs. */
export function warnOncePerMinute(message: string, now: number = Date.now()) {
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn(message);
}
