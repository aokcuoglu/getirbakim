import { z } from "zod";
import { consentSavedAt } from "@/lib/cookie-consent";

const body = z.object({ analytics: z.boolean(), marketing: z.boolean(), savedAt: z.number().int().positive().optional() });

/** Decides POST /api/consent: 403 for a foreign origin, 400 for a bad body, else 204 with the cookie's values. */
export function consentRequest(
  input: { origin: string | null; hosts: string[]; siteOrigin: string; body: unknown; now: number },
): { status: 204; analytics: boolean; marketing: boolean; savedAt: number } | { status: 400 | 403 } {
  let origin: URL | null = null;
  try { origin = input.origin ? new URL(input.origin) : null; } catch { origin = null; }
  if (!origin || (!input.hosts.includes(origin.host) && origin.origin !== input.siteOrigin)) return { status: 403 };
  const parsed = body.safeParse(input.body);
  if (!parsed.success) return { status: 400 };
  const savedAt = consentSavedAt(parsed.data.savedAt, input.now);
  if (savedAt === null) return { status: 400 };
  return { status: 204, analytics: parsed.data.analytics, marketing: parsed.data.marketing, savedAt };
}
