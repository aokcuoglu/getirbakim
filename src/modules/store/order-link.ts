import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed guest order links (#1034): the confirmation email carries `/siparis/<id>/erisim?t=<exp>.<sig>`, so a guest can
 * read the order on any device until `exp`. Stateless HMAC-SHA256 over the order id and expiry; nothing is stored, and
 * rotating the secret voids every link already sent. Pure: no database, no next/*, so scripts/test-order-email.ts covers it.
 * Without a secret of at least 32 characters the feature is off: emails keep the browser-bound links.
 */
export const orderLinkSecretEnv = "ORDER_LINK_SIGNING_SECRET";
export const ORDER_LINK_DAYS = 90;
/** Holds the same `<exp>.<sig>` token, scoped to the order's path; re-verified on every read. */
export const ORDER_LINK_COOKIE = "gb_order_link";
/** Longer than any token this module signs (10-digit exp + 43-char signature); query values above it are rejected unread. */
export const ORDER_LINK_TOKEN_MAX = 80;

const MIN_SECRET_LENGTH = 32;
const tokenPattern = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** The configured signing secret, or null when unset or shorter than 32 characters (feature off). */
export function orderLinkSecret(env: Record<string, string | undefined> = process.env) {
  const secret = env[orderLinkSecretEnv]?.trim() ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

const signature = (orderId: string, exp: string, secret: string) =>
  createHmac("sha256", secret).update(`order-link:v1:${orderId}:${exp}`, "utf8").digest("base64url");

/** `<exp>.<sig>`, exp in unix seconds. */
export function signOrderLink(orderId: string, expiresAt: Date, secret: string) {
  const exp = String(Math.floor(expiresAt.getTime() / 1000));
  return `${exp}.${signature(orderId, exp, secret)}`;
}

/** True only for a token this server signed for this order that has not expired; a malformed token is simply false. */
export function verifyOrderLink(orderId: string, token: string | null | undefined, secret: string, now = new Date()) {
  if (!token || token.length > ORDER_LINK_TOKEN_MAX) return false;
  const match = tokenPattern.exec(token);
  if (!match) return false;
  const [, exp, supplied] = match;
  if (Number(exp) * 1000 <= now.getTime()) return false;
  const expected = Buffer.from(signature(orderId, exp, secret), "ascii");
  const given = Buffer.from(supplied, "ascii");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A fresh token valid for ORDER_LINK_DAYS from `now`, or null when no secret is configured. */
export function orderLinkToken(orderId: string, now = new Date(), env: Record<string, string | undefined> = process.env) {
  const secret = orderLinkSecret(env);
  if (!secret) return null;
  const expiresAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + ORDER_LINK_DAYS * 86_400_000);
  return { token: signOrderLink(orderId, expiresAt, secret), expiresAt };
}

/** Site-relative path of the link that opens the order (or its agreement copy) with `token`. */
export function orderLinkPath(orderId: string, token: string, page?: "sozlesme") {
  const query = new URLSearchParams({ t: token });
  if (page) query.set("sayfa", page);
  return `/siparis/${orderId}/erisim?${query.toString()}`;
}
