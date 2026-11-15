import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONSENT_MAX_AGE, consentSignals, parseConsent, serializeConsent } from "../src/lib/cookie-consent";
import { analyticsConfig } from "../src/modules/analytics/config";
import { addToCart, catalogItem, cleanPageLocation, kurusToValue, search, selectItem, viewItem, viewItemList } from "../src/modules/analytics/events";

const now = Date.UTC(2026, 10, 15);

test("consent cookie: round trip, old versions, expiry and future records", () => {
  const raw = serializeConsent({ analytics: true, marketing: false, savedAt: now });
  assert.equal(raw, `2.1.0.${now / 1000}`);
  assert.deepEqual(parseConsent(raw, now), { version: 2, necessary: true, analytics: true, marketing: false, savedAt: now });
  assert.equal(parseConsent(`1.1.1.${now / 1000}`, now), null);
  assert.equal(parseConsent(JSON.stringify({ version: 1, necessary: true, analytics: true, marketing: true, savedAt: now }), now), null);
  assert.equal(parseConsent(raw, now + CONSENT_MAX_AGE), null);
  assert.equal(parseConsent(serializeConsent({ analytics: true, marketing: true, savedAt: now + 600_000 }), now), null);
  assert.equal(parseConsent(null, now), null);
  assert.equal(parseConsent("2.2.0.1", now), null);
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
  const list = viewItemList({ listId: "fren", listName: "Fren", items: [item, catalogItem(product, 1000)] });
  assert.equal(list.value, 1134.91);
  assert.equal(list.currency, "TRY");
  assert.equal(selectItem({ listId: "fren", listName: "Fren", items: [item] }).item_list_id, "fren");
  const keys = JSON.stringify([added, list, search("fren"), item]).match(/"([a-z_]+)":/g) ?? [];
  assert.equal(keys.filter(key => /email|phone|name_|address/.test(key) || key === '"name":').length, 0);
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
  const { TAG_READY_EVENT, bootGtag, stopGtag, track } = await import("../src/modules/analytics/track");
  browser(`other=1; gb_consent=${serializeConsent({ analytics: true, marketing: false, savedAt: Date.now() })}`);
  assert.ok(consentSnapshot());
  let ready = 0;
  window.addEventListener(TAG_READY_EVENT, () => { ready += 1; });
  assert.equal(track("view_item", {}), false);
  assert.equal(window.dataLayer, undefined);
  bootGtag("G-TEST0000000", "b2c", true, { marketing: false });
  assert.equal(ready, 1);
  const commands = () => (window.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>));
  assert.deepEqual(commands().map(command => command.slice(0, 2).join(":")).slice(0, 5),
    ["consent:default", "consent:update", "js:" + commands()[2][1], "set:user_properties", "config:G-TEST0000000"]);
  assert.equal(track("view_item", { a: 1 }), true);
  assert.deepEqual(commands().at(-1), ["event", "view_item", { page_location: "https://getirbakim.com/", a: 1 }]);
  // Signing in later changes the user property without a second config.
  bootGtag("G-TEST0000000", "b2b", true, { marketing: false });
  assert.equal(commands().filter(command => command[0] === "config").length, 1);
  assert.deepEqual(commands().filter(command => command[0] === "set").at(-1), ["set", "user_properties", { customer_type: "b2b" }]);
  stopGtag("G-TEST0000000");
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
