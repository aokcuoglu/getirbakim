export const CONSENT_COOKIE = "gb_consent";
/** The pre-#644 localStorage record; removed on first read, never trusted. */
export const LEGACY_CONSENT_KEY = "gb_cookie_consent";
export const CONSENT_CHANNEL = "gb-consent";
export const CONSENT_EVENT = "gb:cookie-consent";
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
/** Bumped whenever a new cookie or integration needs a fresh choice (the cookie policy requires it). */
export const CONSENT_VERSION = 2;
/** A record this far ahead of the reader's clock is still accepted (small clock differences). */
export const CONSENT_FUTURE_TOLERANCE = 5 * 60 * 1000;
/** How far a client's reported save time may differ from the server clock before the request is refused. */
export const CONSENT_CLIENT_SKEW = 7 * 24 * 60 * 60 * 1000;

export type CookieConsent = {
  version: typeof CONSENT_VERSION;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  savedAt: number;
};

export type ConsentSignal = "granted" | "denied";
export type ConsentSignals = {
  analytics_storage: ConsentSignal;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
};

/** Cookie value: `2.<analytics 0|1>.<marketing 0|1>.<savedAt in seconds>`. */
export function serializeConsent(consent: Pick<CookieConsent, "analytics" | "marketing" | "savedAt">) {
  return `${CONSENT_VERSION}.${consent.analytics ? 1 : 0}.${consent.marketing ? 1 : 0}.${Math.floor(consent.savedAt / 1000)}`;
}

export function parseConsent(raw: string | null, now = Date.now()): CookieConsent | null {
  const match = raw ? /^(\d+)\.([01])\.([01])\.(\d{1,12})$/.exec(raw) : null;
  if (!match || Number(match[1]) !== CONSENT_VERSION) return null;
  const savedAt = Number(match[4]) * 1000;
  if (savedAt > now + CONSENT_FUTURE_TOLERANCE || now - savedAt >= CONSENT_MAX_AGE) return null;
  return { version: CONSENT_VERSION, necessary: true, analytics: match[2] === "1", marketing: match[3] === "1", savedAt };
}

/** The save time the server writes: the client's own time, never later than the server clock; null when it is implausible. */
export function consentSavedAt(client: number | undefined, now: number) {
  if (client === undefined) return now;
  return Math.abs(client - now) <= CONSENT_CLIENT_SKEW ? Math.min(client, now) : null;
}

/** Consent Mode v2 signals: analytics_storage follows analytics; the three advertising signals follow marketing. */
export function consentSignals(consent: Pick<CookieConsent, "analytics" | "marketing"> | null): ConsentSignals {
  const analytics: ConsentSignal = consent?.analytics ? "granted" : "denied";
  const marketing: ConsentSignal = consent?.marketing ? "granted" : "denied";
  return { analytics_storage: analytics, ad_storage: marketing, ad_user_data: marketing, ad_personalization: marketing };
}

// Optional integrations must check the current preference before loading (see modules/analytics/track.ts).
let sessionConsent: string | null = null;
export function consentSnapshot(): string | null {
  try {
    window.localStorage.removeItem(LEGACY_CONSENT_KEY);
  } catch {
    // Storage may be blocked; the legacy record is ignored anyway.
  }
  const found = document.cookie.split("; ").find(part => part.startsWith(`${CONSENT_COOKIE}=`));
  return found ? found.slice(CONSENT_COOKIE.length + 1) : sessionConsent;
}

export function saveConsent(analytics: boolean, marketing: boolean) {
  const consent: CookieConsent = { version: CONSENT_VERSION, necessary: true, analytics, marketing, savedAt: Date.now() };
  const value = serializeConsent(consent);
  sessionConsent = value;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE / 1000}; SameSite=Lax${secure}`;
  if (!analytics) clearTrackingCookies();
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
  // The server writes the same cookie, so Safari keeps it for the full 180 days instead of 7.
  void fetch("/api/consent", {
    method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analytics, marketing, savedAt: consent.savedAt }),
  }).catch(() => undefined);
  if (typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel(CONSENT_CHANNEL);
    channel.postMessage(value);
    channel.close();
  }
}

export function subscribeConsent(callback: () => void) {
  const onVisible = () => { if (document.visibilityState === "visible") callback(); };
  window.addEventListener(CONSENT_EVENT, callback);
  document.addEventListener("visibilitychange", onVisible);
  // A choice made in another tab: the cookie is shared, so a nudge is enough; `focus` is the fallback.
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CONSENT_CHANNEL) : null;
  if (channel) channel.onmessage = callback;
  else window.addEventListener("focus", callback);
  return () => {
    window.removeEventListener(CONSENT_EVENT, callback);
    document.removeEventListener("visibilitychange", onVisible);
    if (channel) channel.close();
    else window.removeEventListener("focus", callback);
  };
}

const trackingCookie = /^(_ga|_ga_.+|_gcl_.+|_gid|_gat.*|_fbp|_fbc)$/;

/** Deletes the analytics and advertising cookies for the host and every parent domain. */
export function clearTrackingCookies() {
  const parts = window.location.hostname.split(".");
  const domains = [null, ...parts.slice(0, -1).map((_, index) => `.${parts.slice(index).join(".")}`)];
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (!trackingCookie.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}
