import { cookies } from "next/headers";
import { connection } from "next/server";
import { TagManager } from "@/components/privacy/tag-manager";
import { CONSENT_COOKIE } from "@/lib/cookie-consent";
import { analyticsConfig } from "@/modules/analytics/config";
import { currentAccount } from "@/modules/auth/session";

/**
 * Reads the measurement id at request time (runtime env) and keeps admin accounts out of the measurement.
 * Hands the consent cookie down so the cookie banner is part of the server HTML (#736).
 */
export async function StoreTags({ children }: { children: React.ReactNode }) {
  await connection();
  const account = await currentAccount();
  const { ga4 } = analyticsConfig();
  const consent = (await cookies()).get(CONSENT_COOKIE)?.value ?? null;
  const customerType = account?.approved && account.role === "service" ? "b2b" : "b2c";
  return <TagManager ga4={account?.role === "admin" ? null : ga4} customerType={customerType} consent={consent}>{children}</TagManager>;
}
