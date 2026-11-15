"use client";

import Script from "next/script";
import { Suspense, createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { consentSnapshot, parseConsent, subscribeConsent } from "@/lib/cookie-consent";
import { TAG_READY_EVENT, bootGtag, stopGtag, track } from "@/modules/analytics/track";

type Services = { analytics: boolean; marketing: boolean };
const ServicesContext = createContext<Services>({ analytics: false, marketing: false });

/** Which consent categories have a real service behind them; the banner words its options from this. */
export const useConsentServices = () => useContext(ServicesContext);

const serverSnapshot = () => undefined;

function GtagBoot({ ga4, customerType, marketing }: { ga4: string; customerType: string; marketing: boolean }) {
  useEffect(() => {
    bootGtag(ga4, customerType, marketing);
    return () => stopGtag(ga4);
  }, [ga4, customerType, marketing]);
  return <Script id="gtag-js" src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="lazyOnload" />;
}

function PageViewTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const send = () => track("page_view", { page_location: window.location.href, page_title: document.title });
    // On a full load this effect runs before GtagBoot's; the first view is resent once the tag is ready.
    if (send()) return;
    window.addEventListener(TAG_READY_EVENT, send, { once: true });
    return () => window.removeEventListener(TAG_READY_EVENT, send);
  }, [pathname, search]);
  return null;
}

export function TagManager({ ga4, customerType, children }: { ga4: string | null; customerType: string; children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribeConsent, consentSnapshot, serverSnapshot);
  const consent = parseConsent(raw ?? null);
  const active = Boolean(ga4 && consent?.analytics);
  return <ServicesContext value={{ analytics: ga4 !== null, marketing: false }}>
    {active && ga4 && <>
      <GtagBoot ga4={ga4} customerType={customerType} marketing={consent?.marketing ?? false} />
      <Suspense><PageViewTracker /></Suspense>
    </>}
    {children}
  </ServicesContext>;
}
