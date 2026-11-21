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

export type OrderLinkStatus = "valid" | "expired" | "invalid";

/**
 * "valid" for a token this server signed for this order that has not expired; "expired" only when the signature is
 * genuine and the expiry has passed; everything else (malformed, tampered, other order or secret) is "invalid".
 * The signature is compared first so an unsigned expiry never reveals anything.
 */
export function orderLinkStatus(orderId: string, token: string | null | undefined, secret: string, now = new Date()): OrderLinkStatus {
  if (!token || token.length > ORDER_LINK_TOKEN_MAX) return "invalid";
  const match = tokenPattern.exec(token);
  if (!match) return "invalid";
  const [, exp, supplied] = match;
  const expected = Buffer.from(signature(orderId, exp, secret), "ascii");
  const given = Buffer.from(supplied, "ascii");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  return Number(exp) * 1000 <= now.getTime() ? "expired" : "valid";
}

/** True only for a token this server signed for this order that has not expired; a malformed token is simply false. */
export function verifyOrderLink(orderId: string, token: string | null | undefined, secret: string, now = new Date()) {
  return orderLinkStatus(orderId, token, secret, now) === "valid";
}

/** Page that explains a link that did not open an order; carries no order id or token. */
export const ORDER_LINK_NOTICE_PATH = "/siparis/baglanti";
export const orderLinkNotices = { expired: "suresi-doldu", invalid: "gecersiz" } as const;

/** Absolute notice address for a non-valid status, built from the site URL only. */
export function orderLinkNoticeUrl(status: Exclude<OrderLinkStatus, "valid">, siteUrl: string) {
  const url = new URL(ORDER_LINK_NOTICE_PATH, siteUrl);
  url.searchParams.set("durum", orderLinkNotices[status]);
  return url.toString();
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

export type OrderLinkGrant = {
  /** What the token amounts to; "invalid" when the feature is off or no token came. */
  status: OrderLinkStatus;
  /** Absolute address of the explanation page for this status (expired, else invalid). */
  notice: string;
  /** Absolute clean address to redirect to; built from the site URL and the validated order id only (no open redirect). */
  target: string;
  /** The cookie to set, or null when the link is invalid, expired or the feature is off. */
  cookie: { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number } } | null;
};

/** What /siparis/<id>/erisim answers for `token`: always the clean target, a cookie only for a valid link. */
export function orderLinkGrant({ orderId, token, page, siteUrl, secret, now = new Date(), production }: {
  orderId: string; token: string | undefined; page: "sozlesme" | undefined; siteUrl: string; secret: string | null; now?: Date; production: boolean;
}): OrderLinkGrant {
  const path = `/siparis/${orderId}`;
  const target = new URL(page ? `${path}/${page}` : path, siteUrl).toString();
  const status = secret && token ? orderLinkStatus(orderId, token, secret, now) : "invalid";
  const notice = orderLinkNoticeUrl(status === "expired" ? "expired" : "invalid", siteUrl);
  if (status !== "valid" || !token) return { status, notice, target, cookie: null };
  const maxAge = Number(token.split(".")[0]) - Math.floor(now.getTime() / 1000);
  return { status, notice, target, cookie: { name: ORDER_LINK_COOKIE, value: token, options: { httpOnly: true, secure: production, sameSite: "lax", path, maxAge } } };
}

/**
 * Where /siparis/<id>/erisim sends the visitor, and the cookie to set. A cookie only for a granted link on a guest order;
 * a browser that can already view the order goes to it regardless of the link; everything else lands on the notice
 * page (expired for a genuinely signed old link, invalid otherwise, including a valid link for a non-guest order).
 */
export function orderLinkOutcome(grant: OrderLinkGrant, { guestOrder, viewable, siteUrl }: { guestOrder: boolean; viewable: boolean; siteUrl: string }) {
  if (grant.cookie && guestOrder) return { location: grant.target, cookie: grant.cookie };
  if (viewable) return { location: grant.target, cookie: null };
  return { location: grant.status === "valid" ? orderLinkNoticeUrl("invalid", siteUrl) : grant.notice, cookie: null };
}
