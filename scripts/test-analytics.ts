import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONSENT_MAX_AGE, consentBannerOpen, consentSignals, parseConsent, serializeConsent } from "../src/lib/cookie-consent";
import { analyticsConfig, plausibleConfig } from "../src/modules/analytics/config";
import {
  addPaymentInfo, addToCart, beginCheckout, catalogItem, cleanPageLocation, kurusToValue, purchase, removeFromCart, search, selectItem,
  vatIncludedKurus, viewCart, viewItem, viewItemList,
} from "../src/modules/analytics/events";
import { forwardedEvent, resetScriptCache, scriptCache } from "../src/modules/analytics/plausible";
import { PURCHASE_EVENT_WINDOW_DAYS, purchaseClaimAllowed, purchaseEventOpen } from "../src/modules/analytics/purchase";

const now = Date.UTC(2026, 10, 15);

test("consent cookie: round trip, old versions, expiry and future records", () => {
  const raw = serializeConsent({ analytics: true, marketing: false, savedAt: now });
  assert.equal(raw, `3.1.0.${now / 1000}`);
  assert.deepEqual(parseConsent(raw, now), { version: 3, necessary: true, analytics: true, marketing: false, savedAt: now });
  assert.equal(parseConsent(`1.1.1.${now / 1000}`, now), null);
  // Version 3 (#676): a version 2 choice predates the advertising tags and is asked again.
  assert.equal(parseConsent(`2.1.1.${now / 1000}`, now), null);
  assert.equal(parseConsent(JSON.stringify({ version: 1, necessary: true, analytics: true, marketing: true, savedAt: now }), now), null);
  assert.equal(parseConsent(raw, now + CONSENT_MAX_AGE), null);
  assert.equal(parseConsent(serializeConsent({ analytics: true, marketing: true, savedAt: now + 600_000 }), now), null);
  assert.equal(parseConsent(null, now), null);
  assert.equal(parseConsent("3.2.0.1", now), null);
});

test("consent banner: open until a valid choice, and whenever the preferences are open", () => {
  const valid = serializeConsent({ analytics: false, marketing: false, savedAt: now });
  assert.equal(consentBannerOpen(null, false, now), true);
  assert.equal(consentBannerOpen(valid, false, now), false);
  assert.equal(consentBannerOpen(`1.1.1.${now / 1000}`, false, now), true);
  assert.equal(consentBannerOpen(`2.1.1.${now / 1000}`, false, now), true);
  assert.equal(consentBannerOpen(valid, false, now + CONSENT_MAX_AGE), true);
  assert.equal(consentBannerOpen("garbage", false, now), true);
  assert.equal(consentBannerOpen(valid, true, now), true);
});

test("consent signals follow the categories", () => {
  const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  assert.deepEqual(consentSignals(null), denied);
  assert.deepEqual(consentSignals({ analytics: true, marketing: false }), { ...denied, analytics_storage: "granted" });
  // No advertising service is configured: a saved marketing choice does not grant advertising signals.
  assert.deepEqual(consentSignals({ analytics: true, marketing: true }), { ...denied, analytics_storage: "granted" });
  assert.deepEqual(consentSignals({ analytics: true, marketing: true }, { marketing: false }), { ...denied, analytics_storage: "granted" });
  assert.deepEqual(consentSignals({ analytics: true, marketing: false }, { marketing: true }), { ...denied, analytics_storage: "granted" });
  assert.deepEqual(consentSignals({ analytics: false, marketing: true }, { marketing: true }),
    { analytics_storage: "denied", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
});

test("only a well-formed GA4 id loads a tag", () => {
  for (const bad of [undefined, "", "   ", "UA-12345-1", "G-abc", "G-AB"]) assert.equal(analyticsConfig({ GA4_MEASUREMENT_ID: bad }).ga4, null);
  assert.equal(analyticsConfig({ GA4_MEASUREMENT_ID: " G-ABC123XYZ " }).ga4, "G-ABC123XYZ");
});

test("events carry the visitor's price and a lira total", () => {
  assert.equal(kurusToValue(124990), 1249.9);
  const product = { id: "p1", name: "Fren Diski", brand: "BOSCH", category: "Fren" };
  const item = catalogItem(product, 112491, { index: 0 });
  assert.equal(item.price, 1124.91);
  const added = addToCart(item, 3);
  assert.equal(added.currency, "TRY");
  assert.equal(added.value, 3374.73);
  assert.equal(added.items[0].quantity, 3);
  assert.equal(viewItem(item).value, 1124.91);
  // One id across the funnel (#752).
  assert.equal(viewItem(item).items[0].item_id, added.items[0].item_id);
  const list = viewItemList({ listId: "fren", listName: "Fren", items: [item, catalogItem(product, 1000)] });
  assert.equal(list.value, 1134.91);
  assert.equal(list.currency, "TRY");
  assert.equal(selectItem({ listId: "fren", listName: "Fren", items: [item] }).item_list_id, "fren");
  const keys = JSON.stringify([added, list, search("fren"), item]).match(/"([a-z_]+)":/g) ?? [];
  assert.equal(keys.filter(key => /email|phone|name_|address/.test(key) || key === '"name":').length, 0);
});

test("funnel events: cart totals, removed quantity, payment type (#675)", () => {
  const disc = catalogItem({ id: "p1", name: "Fren Diski BOSCH 0986", brand: "BOSCH" }, 112491, { quantity: 2, index: 0 });
  const pad = catalogItem({ id: "p2", name: "Balata TRW GDB", brand: "TRW" }, 50050, { quantity: 1, index: 1 });
  for (const event of [viewCart([disc, pad]), beginCheckout([disc, pad]), addPaymentInfo([disc, pad])]) {
    assert.equal(event.currency, "TRY");
    assert.equal(event.value, 2750.32);
    assert.equal(event.items.length, 2);
  }
  assert.equal(addPaymentInfo([disc]).payment_type, "credit_card");
  const removed = removeFromCart(disc, 1);
  assert.equal(removed.value, 1124.91);
  assert.equal(removed.items[0].quantity, 1);
  assert.equal(disc.quantity, 2);
});

test("purchase: string transaction id, value + shipping = order total, VAT inside the value (#675)", () => {
  const items = [catalogItem({ id: "p1", name: "Fren Diski", brand: "BOSCH" }, 6000, { quantity: 2, index: 0 })];
  const event = purchase({ transactionId: String(1042), subtotalKurus: 12000, shippingKurus: 4990, taxKurus: vatIncludedKurus(12000, 20), items });
  assert.equal(event.transaction_id, "1042");
  assert.equal(typeof event.transaction_id, "string");
  assert.equal(event.currency, "TRY");
  assert.equal(event.value, 120);
  assert.equal(event.shipping, 49.9);
  assert.equal(Math.round((event.value + event.shipping) * 100), 16990);
  assert.equal(event.tax, 20);
  assert.equal(vatIncludedKurus(12000, 20), 2000);
  assert.equal(vatIncludedKurus(12000, 0), 0);
  assert.equal(vatIncludedKurus(11800, 18), 1800);
  const keys = JSON.stringify([event, addPaymentInfo(items), viewCart(items)]).match(/"([a-z_]+)":/g) ?? [];
  assert.equal(keys.filter(key => /email|phone|address|customer|note/.test(key)).length, 0);
});

test("purchase claim: GA4 id, consent and role gate the flag; the window is 7 days (#675)", () => {
  const consent = (analytics: boolean) => serializeConsent({ analytics, marketing: false, savedAt: now });
  const base = { ga4: "G-ABC123XYZ", marketing: false, role: undefined, consent: consent(true), now };
  assert.equal(purchaseClaimAllowed(base), true);
  assert.equal(purchaseClaimAllowed({ ...base, role: "service" }), true);
  assert.equal(purchaseClaimAllowed({ ...base, role: "customer" }), true);
  assert.equal(purchaseClaimAllowed({ ...base, consent: null }), false);
  assert.equal(purchaseClaimAllowed({ ...base, consent: consent(false) }), false);
  assert.equal(purchaseClaimAllowed({ ...base, consent: "garbage" }), false);
  assert.equal(purchaseClaimAllowed({ ...base, role: "admin" }), false);
  assert.equal(purchaseClaimAllowed({ ...base, ga4: null }), false);
  const day = 86_400_000;
  assert.equal(PURCHASE_EVENT_WINDOW_DAYS, 7);
  assert.equal(purchaseEventOpen(null, new Date(now)), false);
  assert.equal(purchaseEventOpen(new Date(now), new Date(now)), true);
  assert.equal(purchaseEventOpen(new Date(now - 7 * day + 1000), new Date(now)), true);
  assert.equal(purchaseEventOpen(new Date(now - 7 * day), new Date(now)), false);
  assert.equal(purchaseEventOpen(new Date(now - 8 * day).toISOString(), new Date(now)), false);
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test("the admin area never loads the tag and no id is baked in at build", () => {
  for (const file of [...sources("src/app/yonetim"), ...sources("src/components/admin")]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /modules\/analytics|privacy\/tag-manager|privacy\/store-tags/, file);
  }
  for (const file of sources("src")) assert.doesNotMatch(readFileSync(file, "utf8"), /NEXT_PUBLIC_GA/, file);
});

test("plausible stays out of the consent-gated tag code and is never baked in at build (#1290)", () => {
  for (const file of ["src/components/privacy/tag-manager.tsx", "src/modules/analytics/track.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /plausible/i, file);
  }
  for (const file of sources("src")) assert.doesNotMatch(readFileSync(file, "utf8"), /NEXT_PUBLIC_PLAUSIBLE/, file);
});

test("plausibleConfig: needs an http(s) URL, strips the path, defaults the domain (#1290)", () => {
  for (const url of [undefined, "", "  ", "not a url", "ftp://plausible.internal", "javascript:alert(1)"]) assert.equal(plausibleConfig({ PLAUSIBLE_URL: url }), null, String(url));
  assert.deepEqual(plausibleConfig({ PLAUSIBLE_URL: "http://plausible.internal:8000/" }), { url: "http://plausible.internal:8000", domain: "getirbakim.com" });
  assert.deepEqual(plausibleConfig({ PLAUSIBLE_URL: "https://p.example.com", PLAUSIBLE_DOMAIN: " shop.example.com " }), { url: "https://p.example.com", domain: "shop.example.com" });
  assert.equal(plausibleConfig({ PLAUSIBLE_URL: "https://p.example.com", PLAUSIBLE_DOMAIN: "Bad Domain!" }), null);
});

const host = "getirbakim.com";
const eventBody = (u: string, extra: Record<string, unknown> = {}) => JSON.stringify({ n: "pageview", u, d: "evil.example", ...extra });

test("forwardedEvent: forces the domain, cleans the address, forwards one resolved IP (#1290)", () => {
  const headers = new Headers({ "user-agent": "Mozilla/5.0 Test", "x-forwarded-for": "203.0.113.9, 198.51.100.7", "cloudfront-viewer-address": "192.0.2.44:51234" });
  const sent = forwardedEvent(eventBody("https://getirbakim.com/giris?next=%2Fyonetim&x=1", { r: "https://getirbakim.com/a?next=%2Fyonetim" }), headers, "getirbakim.com", host);
  assert.ok(sent);
  const body = JSON.parse(sent.body);
  assert.equal(body.d, "getirbakim.com");
  assert.equal(body.u, "https://getirbakim.com/giris?x=1");
  assert.equal(body.r, "https://getirbakim.com/a");
  assert.deepEqual(sent.headers, { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 Test", "X-Forwarded-For": "192.0.2.44" });
  const external = forwardedEvent(eventBody("https://getirbakim.com/", { r: "https://www.google.com/search?q=x" }), new Headers(), "getirbakim.com", host);
  assert.equal(JSON.parse(external!.body).r, "https://www.google.com/search?q=x");
  assert.deepEqual(external!.headers, { "Content-Type": "application/json" });
});

test("forwardedEvent: X-Forwarded-For uses the last hop, never the client-supplied first (#1290)", () => {
  const sent = forwardedEvent(eventBody("https://getirbakim.com/"), new Headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" }), "getirbakim.com", host);
  assert.equal(sent!.headers["X-Forwarded-For"], "198.51.100.7");
});

test("forwardedEvent: drops admin, token links and malformed or oversize bodies (#1290)", () => {
  const headers = new Headers();
  for (const path of ["/yonetim", "/yonetim/urunler/1", "/sifre-yenile/baglanti", "/e-posta-dogrula/baglanti", "/siparis/abc/erisim"]) {
    assert.equal(forwardedEvent(eventBody(`https://getirbakim.com${path}?t=secret`), headers, "getirbakim.com", host), null, path);
  }
  const order = forwardedEvent(eventBody("https://getirbakim.com/siparis/0b8f6a52-1c3d-4e7a-9a41-2f6d3c1b7e90/sozlesme?t=secret"), headers, "getirbakim.com", host);
  assert.equal(JSON.parse(order!.body).u, "https://getirbakim.com/siparis/:id/sozlesme");
  assert.equal(JSON.parse(forwardedEvent(eventBody("https://getirbakim.com/urun/12345678"), headers, "getirbakim.com", host)!.body).u, "https://getirbakim.com/urun/12345678");
  assert.equal(forwardedEvent(eventBody("https://evil.example/"), headers, "getirbakim.com", host), null);
  assert.equal(forwardedEvent(eventBody("http://localhost:3000/"), headers, "getirbakim.com", host) !== null, true);
  assert.deepEqual(Object.keys(JSON.parse(forwardedEvent(eventBody("https://getirbakim.com/", { junk: 1, p: { a: 1 } }), headers, "getirbakim.com", host)!.body)).sort(), ["d", "n", "p", "u"]);
  assert.equal(forwardedEvent("not json", headers, "getirbakim.com", host), null);
  assert.equal(forwardedEvent(JSON.stringify({ n: 1, u: "https://getirbakim.com/" }), headers, "getirbakim.com", host), null);
  assert.equal(forwardedEvent(JSON.stringify(["x"]), headers, "getirbakim.com", host), null);
  assert.equal(forwardedEvent(eventBody("https://getirbakim.com/", { pad: "x".repeat(5000) }), headers, "getirbakim.com", host), null);
});

test("scriptCache: one hour TTL, last good copy on error, null without one (#1290)", async () => {
  resetScriptCache();
  const failing = async () => { throw new Error("down"); };
  assert.equal(await scriptCache(failing, 0), null);
  assert.equal(await scriptCache(async () => "v1", 30_000), null);
  assert.equal(await scriptCache(async () => "v1", 61_000), "v1");
  assert.equal(await scriptCache(async () => "v2", 59 * 60_000), "v1");
  assert.equal(await scriptCache(async () => "v2", 62 * 60_000), "v2");
  assert.equal(await scriptCache(failing, 3 * 60 * 60_000), "v2");
  // Backoff: a failure is not retried for a minute; concurrent callers share one fetch.
  let calls = 0;
  const counting = async () => { calls++; return "v3"; };
  assert.equal(await scriptCache(counting, 3 * 60 * 60_000 + 30_000), "v2");
  assert.equal(calls, 0);
  assert.equal(await scriptCache(counting, 3 * 60 * 60_000 + 61_000), "v3");
  resetScriptCache();
  assert.deepEqual(await Promise.all([scriptCache(counting, 0), scriptCache(counting, 0)]), ["v3", "v3"]);
  assert.equal(calls, 2);
  resetScriptCache();
});

// A minimal browser: a cookie jar, an event target and the globals the modules read.
function browser(cookie = "") {
  const target = new EventTarget();
  const fake = {
    cookie, window: Object.assign(target, { localStorage: { removeItem() {} }, location: { protocol: "https:", hostname: "getirbakim.com", href: "https://getirbakim.com/" } }) as unknown as Window & typeof globalThis,
  };
  Object.assign(globalThis, { window: fake.window, document: fake });
  return fake;
}

test("an event sent before the tag boots is refused, then queued after the boot (hydration order)", async () => {
  const { consentSnapshot } = await import("../src/lib/cookie-consent");
  const { TAG_READY_EVENT, bootTags, stopTags, track } = await import("../src/modules/analytics/track");
  browser(`other=1; gb_consent=${serializeConsent({ analytics: true, marketing: false, savedAt: Date.now() })}`);
  assert.ok(consentSnapshot());
  let ready = 0;
  window.addEventListener(TAG_READY_EVENT, () => { ready += 1; });
  assert.equal(track("view_item", {}), false);
  assert.equal(window.dataLayer, undefined);
  const boot = (customerType: string) => bootTags({
    ga4: "G-TEST0000000", ads: null, metaPixel: null, customerType, consent: { analytics: true, marketing: true }, services: { marketing: false },
  });
  boot("b2c");
  assert.equal(ready, 1);
  const commands = () => (window.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>));
  assert.deepEqual(commands().map(command => command.slice(0, 2).join(":")).slice(0, 5),
    ["consent:default", "consent:update", "js:" + commands()[2][1], "set:user_properties", "config:G-TEST0000000"]);
  assert.equal(track("view_item", { a: 1 }), true);
  assert.deepEqual(commands().at(-1), ["event", "view_item", { page_location: "https://getirbakim.com/", a: 1 }]);
  // Signing in later changes the user property without a second config.
  boot("b2b");
  assert.equal(commands().filter(command => command[0] === "config").length, 1);
  assert.deepEqual(commands().filter(command => command[0] === "set").at(-1), ["set", "user_properties", { customer_type: "b2b" }]);
  stopTags("G-TEST0000000");
  assert.equal((window as unknown as Record<string, boolean>)["ga-disable-G-TEST0000000"], true);
  assert.equal(commands().at(-1)?.[2] && (commands().at(-1)![2] as { analytics_storage: string }).analytics_storage, "denied");
});

test("without analytics consent nothing is queued", async () => {
  const { track } = await import("../src/modules/analytics/track");
  for (const cookie of ["", `gb_consent=${serializeConsent({ analytics: false, marketing: true, savedAt: Date.now() })}`]) {
    browser(cookie);
    window.dataLayer = [];
    window.gtag = (...args: unknown[]) => { window.dataLayer!.push(args); };
    assert.equal(track("view_item", {}), false);
    assert.equal(window.dataLayer.length, 0);
  }
});

test("a save time from a slow clock stays valid; the server never writes a later one", async () => {
  const { consentSavedAt, CONSENT_FUTURE_TOLERANCE } = await import("../src/lib/cookie-consent");
  const client = now - 3_600_000;
  assert.equal(consentSavedAt(client, now), client);
  assert.equal(consentSavedAt(now + 60_000, now), now);
  assert.equal(consentSavedAt(undefined, now), now);
  assert.equal(consentSavedAt(now - 30 * 86_400_000, now), null);
  assert.equal(consentSavedAt(now + 30 * 86_400_000, now), null);
  const written = serializeConsent({ analytics: true, marketing: true, savedAt: consentSavedAt(client, now)! });
  assert.notEqual(parseConsent(written, now), null);
  assert.notEqual(parseConsent(serializeConsent({ analytics: true, marketing: true, savedAt: now + CONSENT_FUTURE_TOLERANCE - 1000 }), now), null);
  assert.equal(parseConsent(serializeConsent({ analytics: true, marketing: true, savedAt: now + CONSENT_FUTURE_TOLERANCE + 2000 }), now), null);
});

test("POST /api/consent: 204, 400 and 403", async () => {
  const { consentRequest } = await import("../src/modules/analytics/consent-request");
  const base = { hosts: ["shop.test"], siteOrigin: "https://getirbakim.com", now, body: { analytics: true, marketing: false } };
  assert.deepEqual(consentRequest({ ...base, origin: "https://shop.test" }), { status: 204, analytics: true, marketing: false, savedAt: now });
  assert.equal(consentRequest({ ...base, origin: "https://getirbakim.com" }).status, 204);
  assert.deepEqual(consentRequest({ ...base, origin: "https://getirbakim.com", body: { analytics: true, marketing: true, savedAt: now - 1000 } }),
    { status: 204, analytics: true, marketing: true, savedAt: now - 1000 });
  assert.equal(consentRequest({ ...base, origin: "https://evil.example" }).status, 403);
  assert.equal(consentRequest({ ...base, origin: null }).status, 403);
  assert.equal(consentRequest({ ...base, origin: "not a url" }).status, 403);
  assert.equal(consentRequest({ ...base, origin: "https://shop.test", body: { analytics: "x" } }).status, 400);
  assert.equal(consentRequest({ ...base, origin: "https://shop.test", body: null }).status, 400);
  assert.equal(consentRequest({ ...base, origin: "https://shop.test", body: { analytics: true, marketing: true, savedAt: 1 } }).status, 400);
});

test("page_location never carries the sign-in `next` parameter", async () => {
  assert.equal(cleanPageLocation("https://getirbakim.com/giris?next=%2Fyonetim"), "https://getirbakim.com/giris");
  assert.equal(cleanPageLocation("https://getirbakim.com/katalog?q=fren&next=%2Fyonetim&page=2"), "https://getirbakim.com/katalog?q=fren&page=2");
  assert.equal(cleanPageLocation("https://getirbakim.com/urun/1"), "https://getirbakim.com/urun/1");
  const { track } = await import("../src/modules/analytics/track");
  browser(`gb_consent=${serializeConsent({ analytics: true, marketing: false, savedAt: Date.now() })}`);
  Object.assign(window.location, { href: "https://getirbakim.com/giris?next=%2Fyonetim" });
  window.dataLayer = [];
  window.gtag = (...args: unknown[]) => { window.dataLayer!.push(args); };
  assert.equal(track("select_item", { a: 1 }), true);
  assert.deepEqual(window.dataLayer[0], ["event", "select_item", { page_location: "https://getirbakim.com/giris", a: 1 }]);
});

test("canTrack: needs both the tag and analytics consent (#675)", async () => {
  const { canTrack } = await import("../src/modules/analytics/track");
  browser(`gb_consent=${serializeConsent({ analytics: true, marketing: false, savedAt: Date.now() })}`);
  assert.equal(canTrack(), false);
  window.gtag = () => undefined;
  assert.equal(canTrack(), true);
  browser("");
  window.gtag = () => undefined;
  assert.equal(canTrack(), false);
  browser(`gb_consent=${serializeConsent({ analytics: false, marketing: true, savedAt: Date.now() })}`);
  window.gtag = () => undefined;
  assert.equal(canTrack(), false);
});

test("stats routes: never an error status, whatever the input or upstream (#1290)", async () => {
  const { GET } = await import("../src/app/stats/js/script.js/route");
  const { POST } = await import("../src/app/stats/api/event/route");
  const { NextRequest } = await import("next/server");
  const event = (body: string, headers: Record<string, string> = {}) => new NextRequest("https://getirbakim.com/stats/api/event", { method: "POST", body, headers });
  const previous = { url: process.env.PLAUSIBLE_URL, fetch: globalThis.fetch };
  try {
    delete process.env.PLAUSIBLE_URL;
    assert.equal((await GET()).status, 404);
    assert.equal((await POST(event(eventBody("https://getirbakim.com/")))).status, 202);
    process.env.PLAUSIBLE_URL = "http://plausible.invalid:8000";
    globalThis.fetch = async () => { throw new Error("down"); };
    resetScriptCache();
    const script = await GET();
    assert.equal(script.status, 200);
    assert.equal(script.headers.get("cache-control"), "no-store");
    assert.equal(await script.text(), "/* stats unavailable */");
    for (const request of [event("not json"), event("x".repeat(5000)), event("{}", { "content-length": "99999" })]) {
      const response = await POST(request);
      assert.equal(response.status, 202);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    if (previous.url === undefined) delete process.env.PLAUSIBLE_URL; else process.env.PLAUSIBLE_URL = previous.url;
    globalThis.fetch = previous.fetch;
    resetScriptCache();
  }
});
