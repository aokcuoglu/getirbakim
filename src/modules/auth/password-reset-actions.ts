"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { clientEvidence } from "@/lib/client-address";
import { attemptKey, withinBudgets } from "./attempt-budget";
import { completePasswordReset, RESET_COOKIE, resetCookieOptions, sendPasswordReset } from "./password-reset";
import type { ResetState } from "./reset-state";
import { resetPasswordSchema, resetRequestSchema } from "./schemas";
import { SESSION_COOKIE, SESSION_SEEN_COOKIE } from "./session-cookie";

const limitError = "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.";
// Per hour: one client address, one email, every request together; the new-password form per client address.
const limits = { ip: 10, email: 5, global: 200, confirmIp: 20 };

/**
 * Asks for a reset link (#1257). The answer is the same whether or not the address has a resettable account, and the
 * mail goes out after the response, so neither the text nor the timing tells them apart.
 */
export async function requestPasswordReset(prev: ResetState, form: FormData): Promise<ResetState> {
  const typed = form.get("email");
  // The typed address comes back after a refusal so the form keeps it.
  const refuse = (message: string): ResetState => ({ status: "error", message, attempt: prev.attempt + 1, email: typeof typed === "string" ? typed.slice(0, 200) : "" });
  const parsed = resetRequestSchema.safeParse({ email: typed });
  if (!parsed.success) return refuse("Geçerli bir e-posta adresi gir.");
  const { email } = parsed.data;
  const { ip } = clientEvidence(await headers());
  const budgets: [string, number][] = [...(ip ? [[attemptKey("reset", "ip", ip), limits.ip] as [string, number]] : []),
    [attemptKey("reset", "email", email), limits.email], ["reset:global", limits.global]];
  if (!await withinBudgets(budgets)) return refuse(limitError);
  // Errors are logged without their message, which may carry the address.
  after(() => sendPasswordReset(email).catch(() => console.error("Password reset request failed")));
  return { status: "sent", attempt: prev.attempt + 1,
    message: "Bu adrese kayıtlı bir hesap varsa şifre yenileme bağlantısını gönderdik. Bağlantı 60 dakika geçerlidir; gelen kutunu ve spam klasörünü kontrol et." };
}

/** Sets the new password with the token the link left in RESET_COOKIE, then ends every session and sends to /giris. */
export async function resetPassword(prev: ResetState, form: FormData): Promise<ResetState> {
  const refuse = (message: string): ResetState => ({ status: "error", message, attempt: prev.attempt + 1 });
  // The form names its password "newPassword" so the browser's confirmation check can find it (auth-field.tsx).
  const parsed = resetPasswordSchema.safeParse({ password: form.get("newPassword"), confirmPassword: form.get("confirmPassword") });
  // The schema's own Turkish messages (12 characters, 72 bytes, mismatch) say exactly what is wrong; zod's defaults are English.
  if (!parsed.success) return refuse(parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "Şifre en az 12 karakter olmalı ve iki şifre aynı olmalı.");
  const { ip } = clientEvidence(await headers());
  if (ip && !await withinBudgets([[attemptKey("reset", "confirm:ip", ip), limits.confirmIp]])) return refuse(limitError);
  const jar = await cookies();
  const token = jar.get(RESET_COOKIE)?.value ?? "";
  const done = await completePasswordReset(token, parsed.data.password);
  jar.set(RESET_COOKIE, "", resetCookieOptions(0));
  if (!done) redirect("/sifre-yenile?durum=gecersiz");
  jar.delete(SESSION_COOKIE);
  jar.delete(SESSION_SEEN_COOKIE);
  redirect("/giris?sifre=yenilendi");
}
