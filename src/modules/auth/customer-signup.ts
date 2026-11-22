"use server";
import { hash } from "bcryptjs";
import { headers } from "next/headers";
import { after } from "next/server";
import { db } from "@/lib/db";
import { clientEvidence } from "@/lib/client-address";
import { attemptKey, withinBudgets } from "./attempt-budget";
import { sendEmailVerification, setVerificationOrigin } from "./email-verification";
import { membershipConsentText } from "./membership-consent";
import { legalPageVersion, membershipTermsSlug, privacyNoticeSlug } from "./membership-terms";
import { customerSignupSchema } from "./schemas";
import { safeReturnTo } from "./return-to";
import type { SignupState } from "./signup-state";

// Per hour: every signup together, one address, one client address.
const limits = { global: 200, email: 3, ip: 10 };

/**
 * Self-service signup for an individual customer (#1254): an approved account with the customer role and no discount,
 * which opens only when its address is verified by the mailed link (#1258). Role, approval and discount are fixed here,
 * never read from the form. The answer is the same for a new address, a replaced unverified signup and an address that
 * already has an account (which gets an "account exists" mail instead and is never changed).
 */
export async function registerCustomer(prev: SignupState, form: FormData): Promise<SignupState> {
  const text = (key: string, max: number) => { const value = form.get(key); return typeof value === "string" ? value.slice(0, max) : ""; };
  const refuse = (message: string): SignupState => ({ status: "error", message, attempt: prev.attempt + 1,
    values: { name: text("name", 150), email: text("email", 200), terms: form.get("terms") === "on" } });
  // The form names its password "newPassword" so the browser's confirmation check can find it (auth-field.tsx).
  const parsed = customerSignupSchema.safeParse({ ...Object.fromEntries(form), password: form.get("newPassword") });
  if (!parsed.success) return refuse("Bilgileri kontrol et: şifre en az 12 karakter olmalı, iki şifre aynı olmalı ve koşulları kabul etmelisin.");
  const { name, email, password } = parsed.data;
  const evidence = clientEvidence(await headers()), { ip } = evidence;
  // Narrowest budget first: a request refused by its client address or its email never spends the shared one, so a
  // single client cannot lock everyone else out.
  const budgets: [string, number][] = [...(ip ? [[attemptKey("signup", "ip", ip), limits.ip] as [string, number]] : []),
    [attemptKey("signup", "email", email), limits.email], ["signup:global", limits.global]];
  if (!await withinBudgets(budgets)) return refuse("Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.");
  // Hashed before the insert either way, so a taken address answers no faster than a new one.
  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // A signup that was never verified holds nothing yet: a new signup with its address replaces it (with its terms
    // acceptance and link), so a typo'd or abandoned attempt cannot block the address.
    await client.query("DELETE FROM accounts WHERE email=$1 AND role='customer' AND email_verified_at IS NULL", [email]);
    // One statement: the account and its terms acceptance (#1256) are created together or not at all. An address that
    // already has an account is left alone.
    await client.query(`WITH created AS (
        INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent,applied_at,email_verified_at)
        VALUES ($1,$2,$3,'customer',true,0,now(),NULL) ON CONFLICT (email) DO NOTHING RETURNING id
      ), accepted AS (
        INSERT INTO account_term_acceptances (account_id,document,terms_version,privacy_notice_version,consent_text,ip,forwarded_for,user_agent)
        SELECT id,$4,$5,$6,$7,$8,$9,$10 FROM created
      ) SELECT id FROM created`, [name, email, passwordHash, membershipTermsSlug, legalPageVersion(membershipTermsSlug),
      legalPageVersion(privacyNoticeSlug), membershipConsentText, evidence.ip, evidence.forwardedFor, evidence.userAgent]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // Set for every signup, so the answer's cookies do not tell a new address from a taken one.
  const originHash = await setVerificationOrigin();
  // After the response: the mail's timing does not tell them apart either. Errors are logged without their message.
  after(() => sendEmailVerification(email, { returnTo: safeReturnTo(form.get("next")), originHash, notifyExisting: true })
    .catch(() => console.error("Signup mail failed")));
  return { status: "sent", message: "", attempt: prev.attempt + 1, values: { name, email, terms: false } };
}
