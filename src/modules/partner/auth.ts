import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Partner API identity (#424). Partner keys live in their own variable and grant only the read endpoints under
 * `/api/partner/v1`; one partner is revoked by removing its pair, the others keep working.
 *
 * Format: `PARTNER_API_KEYS="bakimx:sk_xxx,otherpartner:sk_yyy"`, comma separated `code:key` pairs.
 */
export const partnerKeysEnv = "PARTNER_API_KEYS";

/** Shorter values are treated as typos and never loaded: `bakimx:` must not open the gate with an empty key. */
export const minPartnerKeyLength = 16;

export type PartnerIdentity = { code: string };

/** `PARTNER_API_KEYS` as key → partner code. Broken pairs are skipped so one typo does not lock every partner out. */
export function parsePartnerKeys(raw: string | undefined | null): Map<string, string> {
  const keys = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    // The key itself may contain ":", so only the first separator splits.
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const code = trimmed.slice(0, separator).trim();
    const key = trimmed.slice(separator + 1).trim();
    if (!code || key.length < minPartnerKeyLength) continue;
    // The first definition wins: silently overwriting would reopen a partner thought to be revoked.
    if (!keys.has(key)) keys.set(key, code);
  }
  return keys;
}

/** Constant-time comparison of digests: `timingSafeEqual` on raw values would leak the key length. */
function secretEquals(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function extractBearerToken(header: string | null | undefined): string | null {
  const token = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "")?.[1]?.trim();
  return token || null;
}

/** The partner the request authenticates as, or null. No configured key means a closed gate, not an open one. */
export function resolvePartner(authorization: string | null | undefined, rawKeys: string | undefined | null): PartnerIdentity | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  let matched: string | null = null;
  // Every configured key is compared: a map lookup would answer in key-dependent time.
  for (const [key, code] of parsePartnerKeys(rawKeys)) if (secretEquals(token, key)) matched = code;
  return matched ? { code: matched } : null;
}
