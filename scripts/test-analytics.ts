import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONSENT_MAX_AGE, consentSignals, parseConsent, serializeConsent } from "../src/lib/cookie-consent";
import { analyticsConfig } from "../src/modules/analytics/config";
import { addToCart, catalogItem, kurusToValue, search, selectItem, viewItem, viewItemList } from "../src/modules/analytics/events";

const now = Date.UTC(2026, 10, 15);

test("consent cookie: round trip, old versions, expiry and future records", () => {
  const raw = serializeConsent({ analytics: true, marketing: false, savedAt: now });
  assert.equal(raw, `2.1.0.${now / 1000}`);
  assert.deepEqual(parseConsent(raw, now), { version: 2, necessary: true, analytics: true, marketing: false, savedAt: now });
  assert.equal(parseConsent(`1.1.1.${now / 1000}`, now), null);
  assert.equal(parseConsent(JSON.stringify({ version: 1, necessary: true, analytics: true, marketing: true, savedAt: now }), now), null);
  assert.equal(parseConsent(raw, now + CONSENT_MAX_AGE), null);
  assert.equal(parseConsent(serializeConsent({ analytics: true, marketing: true, savedAt: now + 60_000 }), now), null);
  assert.equal(parseConsent(null, now), null);
  assert.equal(parseConsent("2.2.0.1", now), null);
});

test("consent signals follow the categories", () => {
  const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  assert.deepEqual(consentSignals(null), denied);
  assert.deepEqual(consentSignals({ analytics: true, marketing: false }), { ...denied, analytics_storage: "granted" });
  assert.deepEqual(consentSignals({ analytics: false, marketing: true }),
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
