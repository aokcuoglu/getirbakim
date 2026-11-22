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

/**
 * Self-service signup for an individual customer: an approved account with the customer role and no discount, logged
 * in right away. Role, approval and discount are fixed here, never read from the form. An address that already has an
 * account (any role, approved or not) is neither logged in nor overwritten.
 */
export async function registerCustomer(_prev: SignupState, form: FormData): Promise<SignupState> {
  // The form names its password "newPassword" so the browser's confirmation check can find it (auth-field.tsx).
  const parsed = customerSignupSchema.safeParse({ ...Object.fromEntries(form), password: form.get("newPassword") });
  if (!parsed.success) return { status: "error", message: "Alanları kontrol et. Şifre en az 12 karakter olmalı ve iki şifre aynı olmalı; üyelik koşullarını kabul et." };
  const { name, email, password } = parsed.data;
  const { ip } = clientEvidence(await headers());
  const keys = ["signup:global", hashKey("email", email), ...(ip ? [hashKey("ip", ip)] : [])];
  // Shares the service application's persisted window table; the "signup:" prefix keeps the budgets apart.
  const budget = await db.query<{ key: string; attempts: number }>(`INSERT INTO service_application_attempts AS a (key,attempts)
    SELECT unnest($1::text[]),1 ON CONFLICT (key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END
    RETURNING key,attempts`, [keys]);
  if (budget.rows.some(row => row.attempts > (row.key === "signup:global" ? limits.global : row.key.startsWith("signup:email:") ? limits.email : limits.ip)))
    return { status: "error", message: "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene." };
  // Hashed before the insert either way, so a taken address answers no faster than a new one.
  const passwordHash = await hash(password, 12);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent,applied_at)
    VALUES ($1,$2,$3,'customer',true,0,now()) ON CONFLICT (email) DO NOTHING RETURNING id`, [name, email, passwordHash]);
  const account = rows[0];
  if (!account) return { status: "error", message: "Bu e-posta adresiyle kayıt oluşturulamadı. Zaten hesabın varsa giriş yap." };
  const old = (await cookies()).get(SESSION_COOKIE)?.value;
  if (old) await db.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(old)]);
  await mergeGuestCart(account.id);
  await adoptGuestGarage(account.id);
  await startSession(account.id);
  redirect(safeReturnTo(form.get("next")) ?? "/");
}
