import { cookies } from "next/headers";
import { connection } from "next/server";
import { TagManager } from "@/components/privacy/tag-manager";
import { CONSENT_COOKIE } from "@/lib/cookie-consent";
import { analyticsConfig, plausibleConfig, PLAUSIBLE_EVENT_PATH, PLAUSIBLE_SCRIPT_PATH } from "@/modules/analytics/config";
import { currentAccount } from "@/modules/auth/session";

/**
 * Reads the measurement and advertising ids at request time (runtime env) and keeps admin accounts out of the measurement.
 * The cookieless Plausible tracker (#1290) is a plain server-rendered tag for everyone but admins, independent of consent.
 * Hands the consent cookie down so the cookie banner is part of the server HTML (#736).
 */
export async function StoreTags({ children }: { children: React.ReactNode }) {
  await connection();
  const account = await currentAccount();
  const config = analyticsConfig();
  const consent = (await cookies()).get(CONSENT_COOKIE)?.value ?? null;
  const customerType = account?.approved && account.role === "service" ? "b2b" : "b2c";
  const { ga4, ads, metaPixel } = account?.role === "admin" ? { ga4: null, ads: null, metaPixel: null } : config;
  const plausible = account?.role === "admin" ? null : plausibleConfig();
  return <>
    {plausible && <script async id="plausible-analytics" src={PLAUSIBLE_SCRIPT_PATH} data-domain={plausible.domain} data-api={PLAUSIBLE_EVENT_PATH} />}
    <TagManager ga4={ga4} ads={ads} metaPixel={metaPixel} customerType={customerType} consent={consent}>{children}</TagManager>
  </>;
}
