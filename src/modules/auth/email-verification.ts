import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash } from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { mailConfig, sendMail, type MailMessage, type MailResult } from "@/lib/mail";
import { siteUrl } from "@/lib/site";
import { buildAccountExistsEmail, buildEmailVerificationEmail } from "./account-email";
import { consumeAccountTokenDetails, findAccountToken, issueAccountToken, lockTokenAccount, revokeAccountToken } from "./account-tokens";
import { RESET_TTL_MINUTES, RESETTABLE_ROLES } from "./password-reset";
import { VERIFY_TTL_MINUTES } from "./verification-policy";

export { UNVERIFIED_KEEP_DAYS, VERIFY_TTL_MINUTES } from "./verification-policy";

// E-mail verification before a self-service customer account opens (#1258). A signup creates the account unverified
// (accounts.email_verified_at NULL) and mails a link (/e-posta-dogrula/baglanti?t=…); the link moves the token into
// VERIFY_COOKIE, scoped to /e-posta-dogrula, and the form there verifies. Only the browser that signed up (its nonce in
// VERIFY_ORIGIN_COOKIE matches the token's origin_hash) is logged in right away. In any other browser the signup
// password is discarded and a new one must be set (/sifre-yenile): whoever chose it at signup may not own the address,
// so it opens the account only together with the browser it was chosen in.
export const VERIFY_COOKIE = "gb_verify";
export const VERIFY_ORIGIN_COOKIE = "gb_verify_origin";
export const verifyCookieOptions = (maxAge: number) =>
  ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/e-posta-dogrula", maxAge });
export const originHashOf = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/**
 * Gives this browser a fresh signup nonce and returns its hash for the verification token: only the browser holding the
 * nonce is logged in when the link is used. Scoped to /e-posta-dogrula and kept as long as the link lives. Server
 * Actions only (it sets a cookie).
 */
export async function setVerificationOrigin() {
  const nonce = randomBytes(32).toString("base64url");
  (await cookies()).set(VERIFY_ORIGIN_COOKIE, nonce, verifyCookieOptions(VERIFY_TTL_MINUTES * 60));
  return originHashOf(nonce);
}

type Send = (message: MailMessage) => Promise<MailResult>;
type Options = { returnTo?: string | null; originHash?: string | null; notifyExisting?: boolean; send?: Send; baseUrl?: string };

/**
 * Mails a verification link to an unverified, approved customer with this (lowercased) address. With `notifyExisting`
 * (a signup), a verified customer or approved service account gets an "account exists" mail instead. "none" when
 * nothing is sent; the caller answers the same either way. A failed send withdraws the token and answers "failed".
 */
export async function sendEmailVerification(email: string, { returnTo = null, originHash = null, notifyExisting = false, send = sendMail, baseUrl = siteUrl }: Options = {}) {
  const { rows } = await db.query<{ id: string; name: string; role: string; approved: boolean; email_verified_at: Date | null }>(
    "SELECT id,name,role,approved,email_verified_at FROM accounts WHERE email=$1", [email]);
  const account = rows[0];
  if (!account?.approved) return "none" as const;
  const unverified = account.role === "customer" && account.email_verified_at === null;
  const existing = notifyExisting && account.email_verified_at !== null && (RESETTABLE_ROLES as readonly string[]).includes(account.role);
  if (!unverified && !existing) return "none" as const;
  const token = unverified ? await issueAccountToken(db, account.id, "email_verification", VERIFY_TTL_MINUTES, { returnTo, originHash }) : null;
  const url = token ? `${baseUrl}/e-posta-dogrula/baglanti?t=${token}` : `${baseUrl}/giris`;
  const message = token
    ? buildEmailVerificationEmail({ url, hours: VERIFY_TTL_MINUTES / 60 })
    : buildAccountExistsEmail({ name: account.name, loginUrl: url, resetUrl: `${baseUrl}/sifre-yenile` });
  const kind = token ? "E-mail verification" : "Account exists";
  let result: MailResult;
  try {
    result = await send({ to: email, ...message });
  } catch (error) {
    if (token) await revokeAccountToken(db, token, "email_verification");
    // Never the address or name: a provider's message may carry them, so only its code is logged.
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    console.error(`${kind} mail failed`, { account: account.id, code });
    return "failed" as const;
  }
  console.info(`${kind} mail ${result.status} for account ${account.id}`);
  // Local checks without a mail provider: the link is in the server log. Never in production.
  if (token && process.env.NODE_ENV !== "production" && (result.status === "skipped" || mailConfig().kind === "file")) console.info(`E-mail verification link (dev only): ${url}`);
  return result.status;
}

const sameOrigin = (a: string | null, b: string | null) =>
  Boolean(a && b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)));

/**
 * The verification link's expiry while it is still usable, and whether this browser (`originHash`, its signup nonce's
 * hash) is the one that signed up; null for an unusable link. Does not use the token up.
 */
export async function emailVerificationTarget(token: string, originHash: string | null = null) {
  const found = await findAccountToken(db, token, "email_verification");
  return found ? { expiresAt: found.expiresAt, sameBrowser: sameOrigin(found.originHash, originHash) } : null;
}

export type EmailVerificationResult =
  | { signedIn: true; accountId: string; returnTo: string | null }
  | { signedIn: false; accountId: string; resetToken: string };

/**
 * Uses the token up and marks the address verified. `originHash` is the hash of this browser's signup nonce: when it
 * matches the token's, the caller logs the account in. Otherwise, in the same transaction, the signup password is
 * replaced by an unusable hash, the account's sessions end and a password reset token is issued for the caller to hand
 * to /sifre-yenile. Null for an unknown, expired or used token, or an account that is no longer an approved, unverified
 * customer.
 */
export async function completeEmailVerification(token: string, originHash: string | null): Promise<EmailVerificationResult | null> {
  const found = await findAccountToken(db, token, "email_verification");
  if (!found) return null;
  const signedIn = sameOrigin(found.originHash, originHash);
  // Slow, so before the transaction; nobody knows the random password it hashes.
  const unusableHash = signedIn ? null : await hash(randomBytes(32).toString("base64url"), 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // The account row first, then its tokens: the same lock order as password reset and account deletion.
    const locked = await lockTokenAccount(client, token, "email_verification");
    const details = locked ? await consumeAccountTokenDetails(client, token, "email_verification") : null;
    const updated = details ? await client.query(
      "UPDATE accounts SET email_verified_at=now() WHERE id=$1 AND role='customer' AND approved AND email_verified_at IS NULL RETURNING id", [details.accountId]) : null;
    if (!details || !updated?.rowCount || sameOrigin(details.originHash, originHash) !== signedIn) { await client.query("ROLLBACK"); return null; }
    if (signedIn) {
      await client.query("COMMIT");
      return { signedIn, accountId: details.accountId, returnTo: details.returnTo };
    }
    await client.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [details.accountId, unusableHash]);
    await client.query("DELETE FROM sessions WHERE account_id=$1", [details.accountId]);
    const resetToken = await issueAccountToken(client, details.accountId, "password_reset", RESET_TTL_MINUTES);
    await client.query("COMMIT");
    return { signedIn, accountId: details.accountId, resetToken };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
