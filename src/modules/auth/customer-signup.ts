"use server";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientEvidence } from "@/lib/client-address";
import { mergeGuestCart } from "@/modules/store/cart";
import { adoptGuestGarage } from "@/modules/store/garage";
import { startSession, tokenHash } from "./session";
import { SESSION_COOKIE } from "./session-cookie";
import { customerSignupSchema } from "./schemas";
import { safeReturnTo } from "./return-to";
import type { SignupState } from "./signup-state";

const hashKey = (kind: string, value: string) => `signup:${kind}:${createHash("sha256").update(value).digest("hex")}`;
// Per hour: every signup together, one address, one client address.
const limits = { global: 200, email: 3, ip: 10 };
// One attempt on a key's hourly window (shared with the service application's table; the "signup:" prefix keeps them apart).
async function spend(key: string) {
  const { rows } = await db.query<{ attempts: number }>(`INSERT INTO service_application_attempts AS a (key,attempts) VALUES ($1,1)
    ON CONFLICT (key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END
    RETURNING attempts`, [key]);
  return rows[0].attempts;
}

/**
 * Self-service signup for an individual customer: an approved account with the customer role and no discount, logged
 * in right away. Role, approval and discount are fixed here, never read from the form. An address that already has an
 * account (any role, approved or not) is neither logged in nor overwritten.
 */
export async function registerCustomer(prev: SignupState, form: FormData): Promise<SignupState> {
  const text = (key: string, max: number) => { const value = form.get(key); return typeof value === "string" ? value.slice(0, max) : ""; };
  const refuse = (message: string): SignupState => ({ status: "error", message, attempt: prev.attempt + 1,
    values: { name: text("name", 150), email: text("email", 200), terms: form.get("terms") === "on" } });
  // The form names its password "newPassword" so the browser's confirmation check can find it (auth-field.tsx).
  const parsed = customerSignupSchema.safeParse({ ...Object.fromEntries(form), password: form.get("newPassword") });
  if (!parsed.success) return refuse("Bilgileri kontrol et: şifre en az 12 karakter olmalı, iki şifre aynı olmalı ve koşulları kabul etmelisin.");
  const { name, email, password } = parsed.data;
  const { ip } = clientEvidence(await headers());
  // Narrowest budget first: a request refused by its client address or its email never spends the shared one, so a
  // single client cannot lock everyone else out.
  const budgets: [string, number][] = [...(ip ? [[hashKey("ip", ip), limits.ip] as [string, number]] : []), [hashKey("email", email), limits.email], ["signup:global", limits.global]];
  for (const [key, limit] of budgets) {
    if (await spend(key) > limit) return refuse("Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.");
  }
  // Hashed before the insert either way, so a taken address answers no faster than a new one.
  const passwordHash = await hash(password, 12);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent,applied_at)
    VALUES ($1,$2,$3,'customer',true,0,now()) ON CONFLICT (email) DO NOTHING RETURNING id`, [name, email, passwordHash]);
  const account = rows[0];
  if (!account) return refuse("Bu e-posta adresiyle kayıt oluşturulamadı. Zaten hesabın varsa giriş yap.");
  const old = (await cookies()).get(SESSION_COOKIE)?.value;
  if (old) await db.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(old)]);
  await mergeGuestCart(account.id);
  await adoptGuestGarage(account.id);
  await startSession(account.id);
  redirect(safeReturnTo(form.get("next")) ?? "/");
}
