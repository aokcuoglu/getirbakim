import { cookies, headers } from "next/headers";
import { z } from "zod";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, serializeConsent } from "@/lib/cookie-consent";

const body = z.object({ analytics: z.boolean(), marketing: z.boolean() });

/** Writes the cookie preference from the server so Safari keeps it for 180 days; touches no database. */
export async function POST(request: Request) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const origin = request.headers.get("origin");
  let originHost: string | null = null;
  try { originHost = origin ? new URL(origin).host : null; } catch { originHost = null; }
  if (!host || originHost !== host) return new Response(null, { status: 403 });
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success) return new Response(null, { status: 400 });
  (await cookies()).set(CONSENT_COOKIE, serializeConsent({ ...input.data, savedAt: Date.now() }), {
    path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: CONSENT_MAX_AGE / 1000,
  });
  return new Response(null, { status: 204 });
}
