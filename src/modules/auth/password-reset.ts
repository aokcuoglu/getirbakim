import "server-only";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { mailConfig, sendMail, type MailMessage, type MailResult } from "@/lib/mail";
import { siteUrl } from "@/lib/site";
import { buildPasswordResetEmail } from "./account-email";
import { consumeAccountToken, findAccountToken, issueAccountToken, revokeAccountToken } from "./account-tokens";

// Password reset by e-mail (#1257). The link (/sifre-yenile/baglanti?t=…) moves the token into RESET_COOKIE, scoped to
// /sifre-yenile, and the form there sets the new password. Admin accounts are left out: they recover through the
// database (docs/commerce.md).
export const RESET_TTL_MINUTES = 60;
export const RESETTABLE_ROLES = ["customer", "service"] as const;
export const RESET_COOKIE = "gb_reset";
export const resetCookieOptions = (maxAge: number) =>
  ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/sifre-yenile", maxAge });

type Send = (message: MailMessage) => Promise<MailResult>;

/**
 * Mails a reset link to an approved customer or service account with this (lowercased) address. "none" when there is
 * no such account; the caller answers the same either way. A failed send withdraws the token and answers "failed".
 */
export async function sendPasswordReset(email: string, { send = sendMail, baseUrl = siteUrl }: { send?: Send; baseUrl?: string } = {}) {
  const { rows } = await db.query<{ id: string; name: string }>("SELECT id,name FROM accounts WHERE email=$1 AND approved AND role = ANY($2)", [email, RESETTABLE_ROLES]);
  const account = rows[0];
  if (!account) return "none" as const;
  const token = await issueAccountToken(db, account.id, "password_reset", RESET_TTL_MINUTES);
  const url = `${baseUrl}/sifre-yenile/baglanti?t=${token}`;
  let result: MailResult;
  try {
    result = await send({ to: email, ...buildPasswordResetEmail({ name: account.name, url, minutes: RESET_TTL_MINUTES }) });
  } catch (error) {
    await revokeAccountToken(db, token, "password_reset");
    // Never the address or name: a provider's message may carry them, so only its code is logged.
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    console.error("Password reset mail failed", { account: account.id, code });
    return "failed" as const;
  }
  console.info(`Password reset mail ${result.status} for account ${account.id}`);
  // Local checks without a mail provider: the link is in the server log. Never in production.
  if (process.env.NODE_ENV !== "production" && (result.status === "skipped" || mailConfig().kind === "file")) console.info(`Password reset link (dev only): ${url}`);
  return result.status;
}

/** The reset link's expiry while it is still usable, or null. Does not use the token up. */
export async function passwordResetTarget(token: string) {
  const found = await findAccountToken(db, token, "password_reset");
  return found ? { expiresAt: found.expiresAt } : null;
}

/**
 * Sets the new password with a usable token and uses the token up. Every session of the account ends, its other link
 * tokens go and its failed logins are forgiven. The mailed link proves the address, so an unverified signup (#1258)
 * becomes verified. False for an unknown, expired or used token, or an account that is no longer approved or resettable.
 */
export async function completePasswordReset(token: string, password: string) {
  // An unknown token answers before the slow hash.
  if (!await findAccountToken(db, token, "password_reset")) return false;
  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const accountId = await consumeAccountToken(client, token, "password_reset");
    const updated = accountId ? await client.query<{ email: string }>(
      "UPDATE accounts SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1 AND approved AND role = ANY($3) RETURNING email", [accountId, passwordHash, RESETTABLE_ROLES]) : null;
    const email = updated?.rows[0]?.email;
    if (!accountId || !email) { await client.query("ROLLBACK"); return false; }
    await client.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
    await client.query("DELETE FROM account_tokens WHERE account_id=$1", [accountId]);
    await client.query("DELETE FROM login_attempts WHERE email=$1", [email]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
