import "server-only";
import { mailConfig } from "@/lib/mail";

type Env = Record<string, string | undefined>;

/**
 * Whether the flows that depend on account e-mail are open (#1303): customer signup, its verification link and password
 * reset. In production they open only with ACCOUNT_EMAIL=on and a configured mail transport, so a release cannot offer
 * signup before mail can reach customers; elsewhere they stay open unless ACCOUNT_EMAIL=off. Read at request time.
 */
export function accountEmailEnabled(env: Env = process.env): boolean {
  const flag = env.ACCOUNT_EMAIL?.trim().toLowerCase();
  if (env.NODE_ENV === "production") return flag === "on" && mailConfig(env).kind !== "none";
  return flag !== "off";
}

export const accountEmailClosedMessage = "Bu işlem şu anda kullanılamıyor. Destek için bizimle iletişime geç.";
