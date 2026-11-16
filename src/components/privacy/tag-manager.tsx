"use client";

import Script from "next/script";
import { Suspense, createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { consentSnapshot, parseConsent, subscribeConsent } from "@/lib/cookie-consent";
import { TAG_READY_EVENT, bootGtag, stopGtag, track } from "@/modules/analytics/track";

type Services = { analytics: boolean; marketing: boolean };
const ServicesContext = createContext<Services>({ analytics: false, marketing: false });

/** Which consent categories have a real service behind them; the banner words its options from this. */
export const useConsentServices = () => useContext(ServicesContext);

const ServerConsentContext = createContext<string | null>(null);

/** The consent cookie as the server read it: the banner renders from it, so a first visit gets the banner in the HTML (#736). */
export const useServerConsent = () => useContext(ServerConsentContext);

// No advertising service is configured yet (3rd slice), so advertising consent signals stay denied.
const MARKETING_SERVICE = false;
const serverSnapshot = () => undefined;

function GtagBoot({ ga4, customerType, marketing, marketingService }: { ga4: string; customerType: string; marketing: boolean; marketingService: boolean }) {
  useEffect(() => {
    bootGtag(ga4, customerType, marketing, { marketing: marketingService });
    return () => stopGtag(ga4);
  }, [ga4, customerType, marketing, marketingService]);
  return <Script id="gtag-js" src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="lazyOnload" />;
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
    // On a full load this runs before GtagBoot's effect, so a refused event is resent when the tag is ready.
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

export function TagManager({ ga4, customerType, consent: serverConsent, children }: {
  ga4: string | null; customerType: string; consent: string | null; children: React.ReactNode;
}) {
  const raw = useSyncExternalStore(subscribeConsent, consentSnapshot, serverSnapshot);
  const consent = parseConsent(raw ?? null);
  const active = Boolean(ga4 && consent?.analytics);
  return <ServicesContext value={{ analytics: ga4 !== null, marketing: MARKETING_SERVICE }}><ServerConsentContext value={serverConsent}>
    {active && ga4 && <>
      <GtagBoot ga4={ga4} customerType={customerType} marketing={consent?.marketing ?? false} marketingService={MARKETING_SERVICE} />
      <Suspense><PageViewTracker /></Suspense>
    </>}
    {children}
  </ServerConsentContext></ServicesContext>;
}
