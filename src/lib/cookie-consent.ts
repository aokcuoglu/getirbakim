export const CONSENT_KEY = "gb_cookie_consent";
export const CONSENT_EVENT = "gb:cookie-consent";
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

export type CookieConsent = {
  version: 1;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  savedAt: number;
};

export function parseConsent(raw: string | null, now = Date.now()): CookieConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 || value.necessary !== true ||
      typeof value.analytics !== "boolean" || typeof value.marketing !== "boolean" ||
      typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) ||
      value.savedAt > now || now - value.savedAt >= CONSENT_MAX_AGE
    ) return null;
    return value;
  } catch {
    return null;
  }
}

// Optional integrations must check the current preference before loading.
// No analytics or marketing integrations are currently installed.
let sessionConsent: string | null = null;
export function consentSnapshot(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_KEY) ?? sessionConsent;
  } catch {
    return sessionConsent;
  }
}

export function saveConsent(analytics: boolean, marketing: boolean) {
  const consent: CookieConsent = { version: 1, necessary: true, analytics, marketing, savedAt: Date.now() };
  sessionConsent = JSON.stringify(consent);
  try {
    window.localStorage.setItem(CONSENT_KEY, sessionConsent);
  } catch {
    // Keep the preference for this page when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
}

export function subscribeConsent(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_KEY || event.key === null) {
      sessionConsent = null;
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CONSENT_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CONSENT_EVENT, callback);
  };
}
