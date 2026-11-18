"use client";

import Script from "next/script";
import { Suspense, createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { consentSnapshot, parseConsent, subscribeConsent } from "@/lib/cookie-consent";
import type { AdsConfig } from "@/modules/analytics/config";
import { TAG_READY_EVENT, bootTags, stopTags, track } from "@/modules/analytics/track";

type Services = { analytics: boolean; marketing: boolean; marketingNames: string[] };
const ServicesContext = createContext<Services>({ analytics: false, marketing: false, marketingNames: [] });

/** Which consent categories have a real service behind them; the banner words its options from this. */
export const useConsentServices = () => useContext(ServicesContext);

const ServerConsentContext = createContext<string | null>(null);

/** The consent cookie as the server read it: the banner renders from it, so a first visit gets the banner in the HTML (#736). */
export const useServerConsent = () => useContext(ServerConsentContext);

const serverSnapshot = () => undefined;

type TagBootProps = {
  ga4: string | null; ads: AdsConfig | null; metaPixel: string | null; customerType: string; analytics: boolean; marketing: boolean;
};

/** Boots the tags the consent allows (#676); gtag.js and fbevents.js load only when a consented service needs them. */
function TagBoot({ ga4, ads, metaPixel, customerType, analytics, marketing }: TagBootProps) {
  const adsId = ads?.id ?? null;
  const purchaseLabel = ads?.purchaseLabel ?? null;
  useEffect(() => {
    const adsConfig = adsId ? { id: adsId, purchaseLabel } : null;
    // Google's advertising signals follow Google Ads; the Meta Pixel has its own consent command.
    bootTags({ ga4, ads: adsConfig, metaPixel, customerType, consent: { analytics, marketing }, services: { marketing: adsConfig !== null } });
    return () => stopTags(ga4);
  }, [ga4, adsId, purchaseLabel, metaPixel, customerType, analytics, marketing]);
  const analyticsOn = Boolean(ga4 && analytics);
  const gtagId = analyticsOn ? ga4 : marketing ? adsId : null;
  return <>
    {gtagId && <Script id="gtag-js" src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`} strategy="lazyOnload" />}
    {marketing && metaPixel && <Script id="meta-pixel" src="https://connect.facebook.net/en_US/fbevents.js" strategy="lazyOnload" />}
  </>;
}

// Next updates document.title after the route commits, so a client navigation's title is read late: the view is sent
// when the title has changed since the last one, or after a short wait (the title may legitimately stay the same).
const TITLE_WAIT_MS = 300;

function PageViewTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const lastTitle = useRef<string | null>(null);
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => { if (document.title) fire(); });
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      window.removeEventListener(TAG_READY_EVENT, fire);
    };
    // On a full load this runs before TagBoot's effect, so a refused event is resent when the tag is ready.
    function fire() {
      if (done || !track("page_view", { page_title: document.title })) return;
      done = true;
      lastTitle.current = document.title;
      stop();
    }
    window.addEventListener(TAG_READY_EVENT, fire);
    if (lastTitle.current === null || (document.title && document.title !== lastTitle.current)) fire();
    if (!done) {
      observer.observe(document.head, { subtree: true, childList: true, characterData: true });
      timer = setTimeout(fire, TITLE_WAIT_MS);
    }
    return () => { done = true; stop(); };
  }, [pathname, search]);
  return null;
}

export function TagManager({ ga4, ads, metaPixel, customerType, consent: serverConsent, children }: {
  ga4: string | null; ads: AdsConfig | null; metaPixel: string | null; customerType: string; consent: string | null;
  children: React.ReactNode;
}) {
  const raw = useSyncExternalStore(subscribeConsent, consentSnapshot, serverSnapshot);
  const consent = parseConsent(raw ?? null);
  const analyticsOn = Boolean(ga4 && consent?.analytics);
  const marketingOn = Boolean(consent?.marketing && (ads || metaPixel));
  const marketingNames = [...(ads ? ["Google Ads"] : []), ...(metaPixel ? ["Meta"] : [])];
  const services = { analytics: ga4 !== null, marketing: marketingNames.length > 0, marketingNames };
  return <ServicesContext value={services}><ServerConsentContext value={serverConsent}>
    {(analyticsOn || marketingOn) && <TagBoot ga4={ga4} ads={ads} metaPixel={metaPixel} customerType={customerType}
      analytics={analyticsOn} marketing={marketingOn} />}
    {analyticsOn && <Suspense><PageViewTracker /></Suspense>}
    {children}
  </ServerConsentContext></ServicesContext>;
}
