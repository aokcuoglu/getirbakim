import { connection } from "next/server";
import { TagManager } from "@/components/privacy/tag-manager";
import { analyticsConfig } from "@/modules/analytics/config";
import { currentAccount } from "@/modules/auth/session";

/** Reads the measurement id at request time (runtime env) and keeps admin accounts out of the measurement. */
export async function StoreTags({ children }: { children: React.ReactNode }) {
  await connection();
  const account = await currentAccount();
  const { ga4 } = analyticsConfig();
  const customerType = account?.approved && account.role === "service" ? "b2b" : "b2c";
  return <TagManager ga4={account?.role === "admin" ? null : ga4} customerType={customerType}>{children}</TagManager>;
}
