import { cleanPageLocation } from "@/modules/analytics/events";
import { adCommands } from "@/modules/analytics/ads";
import type { AdsConfig } from "@/modules/analytics/config";
import { consentSignals, consentSnapshot, parseConsent } from "@/lib/cookie-consent";

/** Meta's standard queue stub: calls wait in `queue` until fbevents.js takes over through `callMethod`. */
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void; queue: unknown[]; push: Fbq; loaded: boolean; version: string;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

/** Fired once the tags are ready, so events that came earlier than the tags (child effects run first) can be resent. */
export const TAG_READY_EVENT = "gb:tag-ready";

// What the store booted with. `ga4: undefined` means not booted yet: an installed gtag alone decides (the tests' manual tag).
const tags: { ga4: string | null | undefined; ads: AdsConfig | null; metaPixel: string | null } = { ga4: undefined, ads: null, metaPixel: null };
// Ids already configured on the current gtag / initialised on the current fbq; reset when the tag itself is new.
const gtagConfigured = new Set<string>();
const pixelsStarted = new Set<string>();

const disableKey = (ga4: string) => `ga-disable-${ga4}`;
const setDisabled = (ga4: string, value: boolean) => { (window as unknown as Record<string, boolean>)[disableKey(ga4)] = value; };

function installGtag() {
  if (typeof window.gtag === "function") return false;
  gtagConfigured.clear();
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js only understands `arguments` objects; pushing an array would silently drop every command.
  // eslint-disable-next-line prefer-rest-params -- the real `arguments` object is the protocol
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag("consent", "default", consentSignals(null));
  return true;
}

function installFbq() {
  if (typeof window.fbq === "function") return;
  pixelsStarted.clear();
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    // eslint-disable-next-line prefer-rest-params -- fbevents.js replays the queued `arguments` objects
    else fbq.queue.push(arguments);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;
}

/**
 * Installs the tags the consent allows and sends their commands in order (#676): Consent Mode default, update, js, user
 * properties, GA4 config (analytics), Google Ads config (marketing); Meta Pixel only with marketing consent.
 * `services.marketing` says whether a Google advertising service is configured, so the ad signals may be granted.
 */
export function bootTags(input: {
  ga4: string | null; ads: AdsConfig | null; metaPixel: string | null; customerType: string;
  consent: { analytics: boolean; marketing: boolean }; services: { marketing: boolean };
}) {
  const { ga4, ads, metaPixel, customerType, consent, services } = input;
  Object.assign(tags, { ga4, ads, metaPixel });
  const analyticsOn = Boolean(ga4 && consent.analytics);
  const adsOn = Boolean(ads && consent.marketing);
  if (analyticsOn || adsOn) {
    if (ga4 && analyticsOn) setDisabled(ga4, false);
    const first = installGtag();
    window.gtag!("consent", "update", consentSignals(consent, services));
    if (first) window.gtag!("js", new Date());
    // The visitor may sign in later, so this runs on every boot, not only the first.
    if (consent.analytics) window.gtag!("set", "user_properties", { customer_type: customerType });
    if (ga4 && analyticsOn && !gtagConfigured.has(ga4)) {
      window.gtag!("config", ga4, { send_page_view: false });
      gtagConfigured.add(ga4);
    }
    if (ads && adsOn && !gtagConfigured.has(ads.id)) {
      window.gtag!("config", ads.id);
      gtagConfigured.add(ads.id);
    }
  }
  if (metaPixel && consent.marketing) {
    installFbq();
    const fbq = window.fbq!;
    fbq("consent", "grant");
    if (!pixelsStarted.has(metaPixel)) {
      // No automatic button/form scraping: only the events mapped in ads.ts leave.
      fbq("set", "autoConfig", false, metaPixel);
      fbq("init", metaPixel);
      fbq("track", "PageView");
      pixelsStarted.add(metaPixel);
    }
  }
  window.dispatchEvent(new Event(TAG_READY_EVENT));
}

/** Consent withdrawn or the storefront left: no further measurement, including GA4's own history page views and the pixel. */
export function stopTags(ga4: string | null) {
  if (ga4) setDisabled(ga4, true);
  window.gtag?.("consent", "update", consentSignals(null));
  window.fbq?.("consent", "revoke");
}

const currentConsent = () => parseConsent(consentSnapshot());
const ga4Ready = () => typeof window.gtag === "function" && (tags.ga4 === undefined || (tags.ga4 !== null && gtagConfigured.has(tags.ga4)));
const adsReady = () => typeof window.gtag === "function" && tags.ads !== null && gtagConfigured.has(tags.ads.id);
const pixelReady = () => typeof window.fbq === "function" && tags.metaPixel !== null && pixelsStarted.has(tags.metaPixel);

/** Whether an event would be queued now: GA4 with analytics consent, or an advertising tag with marketing consent. */
export function canTrack() {
  const consent = currentConsent();
  return Boolean((consent?.analytics && ga4Ready()) || (consent?.marketing && (adsReady() || pixelReady())));
}

/**
 * The single exit for measurement events: GA4 with analytics consent, the advertising tags (ads.ts) with marketing consent.
 * Returns whether any channel queued the event; nothing is sent before consent.
 */
export function track(name: string, params: Record<string, unknown>) {
  const consent = currentConsent();
  let queued = false;
  if (consent?.analytics && ga4Ready()) {
    // With Google Ads on the same gtag, an event without send_to would also reach the Ads id.
    const target = tags.ads && tags.ga4 ? { send_to: tags.ga4 } : {};
    window.gtag!("event", name, { page_location: cleanPageLocation(window.location.href), ...params, ...target });
    queued = true;
  }
  if (consent?.marketing) {
    const commands = adCommands(name, params, { ads: adsReady() ? tags.ads : null, metaPixel: pixelReady() ? tags.metaPixel : null });
    for (const command of commands) {
      if (command.tag === "gtag") window.gtag!(...command.args);
      else window.fbq!(...command.args);
      queued = true;
    }
  }
  return queued;
}
