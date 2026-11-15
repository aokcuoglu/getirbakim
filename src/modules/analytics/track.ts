import { consentSnapshot, parseConsent } from "@/lib/cookie-consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** The single exit for analytics events: nothing is sent before the visitor allows analytics. */
export function track(name: string, params: Record<string, unknown>) {
  if (typeof window.gtag !== "function") return;
  if (!parseConsent(consentSnapshot())?.analytics) return;
  window.gtag("event", name, params);
}
