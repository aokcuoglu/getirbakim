"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { clientEvidence } from "@/lib/client-address";
import { mergeGuestCart } from "@/modules/store/cart";
import { adoptGuestGarage } from "@/modules/store/garage";
import { attemptKey, withinBudgets } from "./attempt-budget";
import { completeEmailVerification, originHashOf, sendEmailVerification, setVerificationOrigin, VERIFY_COOKIE, VERIFY_ORIGIN_COOKIE, verifyCookieOptions } from "./email-verification";
import type { ResetState } from "./reset-state";
import { safeReturnTo } from "./return-to";
import { resetRequestSchema } from "./schemas";
import { startSession, tokenHash } from "./session";
import { SESSION_COOKIE } from "./session-cookie";

const limitError = "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.";
// Per hour: one client address, one email, every request together; the verify form per client address.
const limits = { ip: 10, email: 3, global: 200, confirmIp: 20 };

/**
 * Verifies the address with the token the link left in VERIFY_COOKIE (#1258). The browser that signed up is logged in
 * and sent where it was going; any other browser goes to /giris to log in with the password.
 */
export async function verifyEmail(prev: ResetState): Promise<ResetState> {
  const { ip } = clientEvidence(await headers());
  if (ip && !await withinBudgets([[attemptKey("verify", "confirm:ip", ip), limits.confirmIp]])) return { status: "error", message: limitError, attempt: prev.attempt + 1 };
  const jar = await cookies();
  const verified = await completeEmailVerification(jar.get(VERIFY_COOKIE)?.value ?? "");
  jar.set(VERIFY_COOKIE, "", verifyCookieOptions(0));
  if (!verified) redirect("/e-posta-dogrula?durum=gecersiz");
  const next = safeReturnTo(verified.returnTo);
  const nonce = jar.get(VERIFY_ORIGIN_COOKIE)?.value;
  if (nonce && verified.originHash && originHashOf(nonce) === verified.originHash) {
    const old = jar.get(SESSION_COOKIE)?.value;
    if (old) await db.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(old)]);
    await mergeGuestCart(verified.accountId);
    await adoptGuestGarage(verified.accountId);
    await startSession(verified.accountId);
    jar.set(VERIFY_ORIGIN_COOKIE, "", verifyCookieOptions(0));
    redirect(next ?? "/");
  }
  const params = new URLSearchParams({ dogrulama: "tamam" });
  if (next && next !== "/") params.set("next", next);
  redirect(`/giris?${params}`);
}

/**
 * Asks for a new verification link (#1258). The answer is the same whether or not the address waits for verification,
 * and the mail goes out after the response, so neither the text nor the timing tells them apart.
 */
export async function resendVerification(prev: ResetState, form: FormData): Promise<ResetState> {
  const typed = form.get("email");
  const refuse = (message: string): ResetState => ({ status: "error", message, attempt: prev.attempt + 1, email: typeof typed === "string" ? typed.slice(0, 200) : "" });
  const parsed = resetRequestSchema.safeParse({ email: typed });
  if (!parsed.success) return refuse("Geçerli bir e-posta adresi gir.");
  const { email } = parsed.data;
  const returnTo = safeReturnTo(form.get("next"));
  const { ip } = clientEvidence(await headers());
  const budgets: [string, number][] = [...(ip ? [[attemptKey("verify", "ip", ip), limits.ip] as [string, number]] : []),
    [attemptKey("verify", "email", email), limits.email], ["verify:global", limits.global]];
  if (!await withinBudgets(budgets)) return refuse(limitError);
  // Set for every request, so the answer's cookies do not tell a waiting address from any other.
  const originHash = await setVerificationOrigin();
  // Errors are logged without their message, which may carry the address.
  after(() => sendEmailVerification(email, { returnTo, originHash }).catch(() => console.error("Verification resend failed")));
  return { status: "sent", attempt: prev.attempt + 1,
    message: "Bu adres doğrulama bekliyorsa yeni bir doğrulama bağlantısı gönderdik. Bağlantı 24 saat geçerlidir; gelen kutunu ve spam klasörünü kontrol et." };
}
