"use client";

import Script from "next/script";
import { Suspense, createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { consentSignals, consentSnapshot, parseConsent, subscribeConsent } from "@/lib/cookie-consent";
import { track } from "@/modules/analytics/track";

type Services = { analytics: boolean; marketing: boolean };
const ServicesContext = createContext<Services>({ analytics: false, marketing: false });

/** Which consent categories have a real service behind them; the banner words its options from this. */
export const useConsentServices = () => useContext(ServicesContext);

const serverSnapshot = () => undefined;

function GtagBoot({ ga4, customerType, marketing }: { ga4: string; customerType: string; marketing: boolean }) {
  useEffect(() => {
    const flag = `ga-disable-${ga4}` as const;
    (window as unknown as Record<string, boolean>)[flag] = false;
    if (!window.gtag) {
      window.dataLayer = window.dataLayer ?? [];
      // gtag.js only understands `arguments` objects; pushing an array would silently drop every command.
      // eslint-disable-next-line prefer-rest-params -- the real `arguments` object is the protocol
      window.gtag = function () { window.dataLayer!.push(arguments); };
      window.gtag("consent", "default", consentSignals(null));
      window.gtag("js", new Date());
      window.gtag("set", "user_properties", { customer_type: customerType });
      window.gtag("config", ga4, { send_page_view: false });
    }
    window.gtag("consent", "update", consentSignals({ analytics: true, marketing }));
    // Leaving the storefront (or revoking consent) must stop GA4's own history-change page views.
    return () => { (window as unknown as Record<string, boolean>)[flag] = true; };
  }, [ga4, customerType, marketing]);
  return <Script id="gtag-js" src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="lazyOnload" />;
}

function PageViewTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    track("page_view", { page_location: window.location.href, page_title: document.title });
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
