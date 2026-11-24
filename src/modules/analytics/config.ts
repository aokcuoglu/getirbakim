export type AdsConfig = { id: string; purchaseLabel: string | null };
export type AnalyticsConfig = { ga4: string | null; ads: AdsConfig | null; metaPixel: string | null };

const match = (value: string | undefined, pattern: RegExp) => {
  const trimmed = value?.trim() ?? "";
  return pattern.test(trimmed) ? trimmed : null;
};

/**
 * Measurement ids come from the runtime environment (never NEXT_PUBLIC_, which is frozen at build); a missing or malformed
 * id loads no tag. The Google Ads purchase label only means something next to a Google Ads id.
 */
export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig {
  const adsId = match(env.GOOGLE_ADS_ID, /^AW-\d{6,}$/);
  return {
    ga4: match(env.GA4_MEASUREMENT_ID, /^G-[A-Z0-9]{4,}$/),
    ads: adsId ? { id: adsId, purchaseLabel: match(env.GOOGLE_ADS_PURCHASE_LABEL, /^[A-Za-z0-9_-]{6,}$/) } : null,
    metaPixel: match(env.META_PIXEL_ID, /^\d{10,20}$/),
  };
}

export type PlausibleConfig = { url: string; domain: string };

/** Same-origin paths the store serves the tracker and its events on; the app proxies them to the self-hosted Plausible. */
export const PLAUSIBLE_SCRIPT_PATH = "/stats/js/script.js";
export const PLAUSIBLE_EVENT_PATH = "/stats/api/event";

/**
 * Self-hosted Plausible CE (#1290). PLAUSIBLE_URL is the internal base URL read at runtime (never NEXT_PUBLIC_); unset or not
 * an http(s) URL means no script tag and inert /stats/* routes. PLAUSIBLE_DOMAIN is the site name registered in Plausible.
 */
export function plausibleConfig(env: Record<string, string | undefined> = process.env): PlausibleConfig | null {
  const raw = env.PLAUSIBLE_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const domain = env.PLAUSIBLE_DOMAIN?.trim() || "getirbakim.com";
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  return { url: parsed.origin, domain };
}
