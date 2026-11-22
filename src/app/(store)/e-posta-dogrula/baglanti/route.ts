import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/site";
import { ACCOUNT_TOKEN_MAX } from "@/modules/auth/account-tokens";
import { emailVerificationTarget, VERIFY_COOKIE, verifyCookieOptions } from "@/modules/auth/email-verification";

/**
 * The verification e-mail's link (#1258): a usable token becomes a cookie scoped to /e-posta-dogrula and the visitor
 * lands on the clean address, so the token never stays in the address bar, the history or a Referer. GET never uses
 * the token up (mail scanners open links); the form on /e-posta-dogrula does. Redirects are built from the configured
 * site URL.
 */
const token = z.string().min(1).max(ACCOUNT_TOKEN_MAX);

function see(location: string) {
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const parsed = token.safeParse(request.nextUrl.searchParams.get("t"));
  const target = parsed.success ? await emailVerificationTarget(parsed.data) : null;
  if (!parsed.success || !target) {
    const response = see(`${siteUrl}/e-posta-dogrula?durum=gecersiz`);
    response.cookies.set(VERIFY_COOKIE, "", verifyCookieOptions(0));
    return response;
  }
  const response = see(`${siteUrl}/e-posta-dogrula`);
  const seconds = Math.max(1, Math.floor((target.expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(VERIFY_COOKIE, parsed.data, verifyCookieOptions(seconds));
  return response;
}
