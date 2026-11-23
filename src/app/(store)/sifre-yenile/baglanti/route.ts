import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/site";
import { accountEmailEnabled } from "@/modules/auth/account-email-switch";
import { ACCOUNT_TOKEN_MAX } from "@/modules/auth/account-tokens";
import { passwordResetTarget, RESET_COOKIE, resetCookieOptions } from "@/modules/auth/password-reset";

/**
 * The password reset e-mail's link (#1257): a usable token becomes a cookie scoped to /sifre-yenile and the visitor lands
 * on the clean address, so the token never stays in the address bar, the history or a Referer. GET never uses the
 * token up (mail scanners open links); the form on /sifre-yenile does. Redirects are built from the configured site URL.
 */
const token = z.string().min(1).max(ACCOUNT_TOKEN_MAX);

function see(location: string) {
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  // Closed (#1303): no token lookup and no cookie; the link stays as it was.
  if (!accountEmailEnabled()) return see(`${siteUrl}/giris`);
  const parsed = token.safeParse(request.nextUrl.searchParams.get("t"));
  const target = parsed.success ? await passwordResetTarget(parsed.data) : null;
  if (!parsed.success || !target) {
    const response = see(`${siteUrl}/sifre-yenile?durum=gecersiz`);
    response.cookies.set(RESET_COOKIE, "", resetCookieOptions(0));
    return response;
  }
  const response = see(`${siteUrl}/sifre-yenile`);
  const seconds = Math.max(1, Math.floor((target.expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(RESET_COOKIE, parsed.data, resetCookieOptions(seconds));
  return response;
}
