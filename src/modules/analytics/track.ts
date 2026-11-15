import { consentSignals, consentSnapshot, parseConsent } from "@/lib/cookie-consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Fired once gtag is ready, so events that came earlier than the tag (child effects run first) can be resent. */
export const TAG_READY_EVENT = "gb:tag-ready";

const disableKey = (ga4: string) => `ga-disable-${ga4}`;
const setDisabled = (ga4: string, value: boolean) => { (window as unknown as Record<string, boolean>)[disableKey(ga4)] = value; };

/** Installs gtag and sends the Consent Mode commands in order: default, update, js, config. Call only with analytics consent. */
export function bootGtag(ga4: string, customerType: string, marketing: boolean) {
  const first = typeof window.gtag !== "function";
  setDisabled(ga4, false);
  if (first) {
    window.dataLayer = window.dataLayer ?? [];
    // gtag.js only understands `arguments` objects; pushing an array would silently drop every command.
    // eslint-disable-next-line prefer-rest-params -- the real `arguments` object is the protocol
    window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag("consent", "default", consentSignals(null));
  }
  window.gtag!("consent", "update", consentSignals({ analytics: true, marketing }));
  if (first) window.gtag!("js", new Date());
  // The visitor may sign in later, so this runs on every boot, not only the first.
  window.gtag!("set", "user_properties", { customer_type: customerType });
  if (first) window.gtag!("config", ga4, { send_page_view: false });
  window.dispatchEvent(new Event(TAG_READY_EVENT));
}

/** Consent withdrawn or the storefront left: no further measurement, including GA4's own history page views. */
export function stopGtag(ga4: string) {
  setDisabled(ga4, true);
  window.gtag?.("consent", "update", consentSignals(null));
}

/** The single exit for analytics events. Returns whether the event was queued; nothing is sent before analytics consent. */
export function track(name: string, params: Record<string, unknown>) {
  if (typeof window.gtag !== "function") return false;
  if (!parseConsent(consentSnapshot())?.analytics) return false;
  window.gtag("event", name, params);
  return true;
}
