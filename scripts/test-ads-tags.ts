import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { clearTrackingCookies, consentSignals, serializeConsent, trackingCookieRefused } from "../src/lib/cookie-consent";
import { adCommands } from "../src/modules/analytics/ads";
import { analyticsConfig } from "../src/modules/analytics/config";
import { beginCheckout, catalogItem, purchase, viewItem } from "../src/modules/analytics/events";
import { purchaseClaimAllowed } from "../src/modules/analytics/purchase";
import { bootTags, canTrack, stopTags, track } from "../src/modules/analytics/track";

const now = Date.UTC(2026, 10, 18);
const GA4 = "G-TEST0000000";
const ADS = { id: "AW-1234567890", purchaseLabel: "AbC_123-xyz" };
const PIXEL = "123456789012345";

const disc = catalogItem({ id: "p1", name: "Fren Diski", brand: "BOSCH", category: "Fren" }, 112491, { quantity: 2, index: 0 });
const pad = catalogItem({ id: "p2", name: "Balata", brand: "TRW" }, 50050, { quantity: 1, index: 1 });
const order = purchase({ transactionId: "1042", subtotalKurus: 275032, shippingKurus: 4990, taxKurus: 45839, items: [disc, pad] });

test("config: only well-formed advertising ids load a tag; the label needs a Google Ads id", () => {
  assert.deepEqual(analyticsConfig({}), { ga4: null, ads: null, metaPixel: null });
  assert.deepEqual(analyticsConfig({ GA4_MEASUREMENT_ID: "", GOOGLE_ADS_ID: "", GOOGLE_ADS_PURCHASE_LABEL: "", META_PIXEL_ID: "" }),
    { ga4: null, ads: null, metaPixel: null });
  assert.deepEqual(analyticsConfig({
    GA4_MEASUREMENT_ID: GA4, GOOGLE_ADS_ID: ` ${ADS.id} `, GOOGLE_ADS_PURCHASE_LABEL: ` ${ADS.purchaseLabel} `, META_PIXEL_ID: ` ${PIXEL} `,
  }), { ga4: GA4, ads: ADS, metaPixel: PIXEL });
  for (const bad of ["AW-12345", "aw-1234567", "G-ABC123", "AW-12345678x", "1234567"]) assert.equal(analyticsConfig({ GOOGLE_ADS_ID: bad }).ads, null);
  for (const bad of ["123456789", "123456789012345678901", "12345678901a", "fb-1234567890"]) {
    assert.equal(analyticsConfig({ META_PIXEL_ID: bad }).metaPixel, null);
  }
  assert.deepEqual(analyticsConfig({ GOOGLE_ADS_ID: ADS.id, GOOGLE_ADS_PURCHASE_LABEL: "ab c/d" }).ads, { id: ADS.id, purchaseLabel: null });
  assert.deepEqual(analyticsConfig({ GOOGLE_ADS_ID: ADS.id, GOOGLE_ADS_PURCHASE_LABEL: "abc" }).ads, { id: ADS.id, purchaseLabel: null });
  assert.equal(analyticsConfig({ GOOGLE_ADS_PURCHASE_LABEL: ADS.purchaseLabel }).ads, null);
});

test("adCommands: the four Meta events, the purchase conversion and nothing else", () => {
  const cfg = { ads: ADS, metaPixel: PIXEL };
  assert.deepEqual(adCommands("view_item", viewItem(disc), cfg), [{
    tag: "fbq", args: ["track", "ViewContent", {
      content_type: "product", content_ids: ["p1"], contents: [{ id: "p1", quantity: 2, item_price: 1124.91 }], value: 2249.82, currency: "TRY",
    }],
  }]);
  assert.deepEqual(adCommands("add_to_cart", { currency: "TRY", value: 1124.91, items: [{ ...disc, quantity: 1 }] }, cfg)[0].args.slice(0, 2),
    ["track", "AddToCart"]);
  const checkout = adCommands("begin_checkout", beginCheckout([disc, pad]), cfg);
  assert.equal(checkout.length, 1);
  assert.deepEqual(checkout[0].args, ["track", "InitiateCheckout", {
    content_type: "product", content_ids: ["p1", "p2"],
    contents: [{ id: "p1", quantity: 2, item_price: 1124.91 }, { id: "p2", quantity: 1, item_price: 500.5 }],
    value: 2750.32, currency: "TRY", num_items: 3,
  }]);
  const bought = adCommands("purchase", order, cfg);
  assert.deepEqual(bought.map(command => command.tag), ["fbq", "gtag"]);
  assert.deepEqual(bought[0].args.slice(0, 2), ["track", "Purchase"]);
  assert.equal((bought[0].args[2] as { value: number }).value, order.value);
  assert.equal((bought[0].args[2] as { num_items: number }).num_items, 3);
  assert.deepEqual(bought[0].args[3], { eventID: "1042" });
  assert.deepEqual(bought[1].args, ["event", "conversion", {
    send_to: "AW-1234567890/AbC_123-xyz", value: order.value, currency: "TRY", transaction_id: "1042",
  }]);
  // No label: no Google Ads conversion; no pixel: no Meta event.
  assert.deepEqual(adCommands("purchase", order, { ads: { id: ADS.id, purchaseLabel: null }, metaPixel: null }), []);
  assert.deepEqual(adCommands("purchase", order, { ads: ADS, metaPixel: null }).map(command => command.tag), ["gtag"]);
  assert.deepEqual(adCommands("view_item", viewItem(disc), { ads: ADS, metaPixel: null }), []);
  for (const name of ["view_cart", "search", "refund", "page_view", "view_item_list", "select_item", "remove_from_cart", "add_payment_info"]) {
    assert.deepEqual(adCommands(name, { ...order, search_term: "fren", page_title: "x" }, cfg), [], name);
  }
  const sent = JSON.stringify([...adCommands("view_item", viewItem(disc), cfg), ...bought]);
  assert.doesNotMatch(sent, /page_location|item_name|item_brand|email|phone|address|getirbakim\.com/);
});

// A minimal browser: a cookie jar, an event target and the globals the modules read.
function browser(analytics: boolean, marketing: boolean) {
  const target = new EventTarget();
  const cookie = `gb_consent=${serializeConsent({ analytics, marketing, savedAt: Date.now() })}`;
  const fake = {
    cookie,
    window: Object.assign(target, {
      localStorage: { removeItem() {} }, location: { protocol: "https:", hostname: "getirbakim.com", href: "https://getirbakim.com/urun/1?next=%2Fyonetim" },
    }) as unknown as Window & typeof globalThis,
  };
  Object.assign(globalThis, { window: fake.window, document: fake });
  return fake;
}

const gtagCommands = () => (window.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>));
const fbqCommands = () => (window.fbq?.queue ?? []).map(entry => Array.from(entry as ArrayLike<unknown>));
const boot = (consent: { analytics: boolean; marketing: boolean }, env: { ga4?: string | null; ads?: typeof ADS | null; metaPixel?: string | null } = {}) => {
  const ads = env.ads === undefined ? ADS : env.ads;
  bootTags({
    ga4: env.ga4 === undefined ? GA4 : env.ga4, ads, metaPixel: env.metaPixel === undefined ? PIXEL : env.metaPixel,
    customerType: "b2c", consent, services: { marketing: ads !== null },
  });
};

test("analytics only: GA4 boots, no pixel, no Google Ads config, advertising signals denied", () => {
  browser(true, false);
  boot({ analytics: true, marketing: false });
  assert.equal(window.fbq, undefined);
  const commands = gtagCommands();
  assert.equal(commands.some(command => command[0] === "config" && String(command[1]).startsWith("AW-")), false);
  assert.deepEqual(commands.filter(command => command[0] === "config").map(command => command[1]), [GA4]);
  assert.deepEqual(commands[1], ["consent", "update", { ...consentSignals(null), analytics_storage: "granted" }]);
  assert.equal(track("view_item", viewItem(disc)), true);
  // Google Ads is configured on the site, so the GA4 event names its own target.
  assert.deepEqual(gtagCommands().at(-1), ["event", "view_item", { page_location: "https://getirbakim.com/urun/1", ...viewItem(disc), send_to: GA4 }]);
  assert.equal(track("purchase", order), true);
  assert.equal(gtagCommands().some(command => command[1] === "conversion"), false);
});

test("marketing only: no GA4 config or event, advertising signals granted, Meta and Ads events queued", () => {
  browser(false, true);
  boot({ analytics: false, marketing: true });
  const commands = gtagCommands();
  assert.deepEqual(commands.filter(command => command[0] === "config").map(command => command[1]), [ADS.id]);
  assert.equal(commands.some(command => command[0] === "set"), false);
  assert.deepEqual(commands[1], ["consent", "update", { analytics_storage: "denied", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" }]);
  assert.deepEqual(fbqCommands(), [["consent", "grant"], ["set", "autoConfig", false, PIXEL], ["init", PIXEL], ["track", "PageView"]]);
  assert.equal(window._fbq, window.fbq);
  assert.equal(window.fbq?.version, "2.0");
  assert.equal(canTrack(), true);
  assert.equal(track("view_item", viewItem(disc)), true);
  assert.deepEqual(fbqCommands().at(-1)?.slice(0, 2), ["track", "ViewContent"]);
  assert.equal(gtagCommands().some(command => command[0] === "event" && command[1] === "view_item"), false);
  assert.equal(track("page_view", { page_title: "x" }), false);
  assert.equal(track("purchase", order), true);
  assert.deepEqual(gtagCommands().at(-1)?.slice(0, 2), ["event", "conversion"]);
  assert.deepEqual(fbqCommands().at(-1)?.[3], { eventID: "1042" });
  // A second boot (e.g. sign-in) neither re-inits the pixel nor re-configures Google Ads.
  boot({ analytics: false, marketing: true });
  assert.equal(fbqCommands().filter(command => command[0] === "init").length, 1);
  assert.equal(gtagCommands().filter(command => command[0] === "config").length, 1);
});

test("both: GA4 events carry send_to, the purchase reaches all three", () => {
  browser(true, true);
  boot({ analytics: true, marketing: true });
  assert.deepEqual(gtagCommands().filter(command => command[0] === "config").map(command => command[1]), [GA4, ADS.id]);
  assert.equal(track("purchase", order), true);
  const events = gtagCommands().filter(command => command[0] === "event");
  assert.deepEqual(events.map(command => command[1]), ["purchase", "conversion"]);
  assert.equal((events[0][2] as { send_to: string }).send_to, GA4);
  assert.deepEqual(fbqCommands().at(-1)?.slice(0, 2), ["track", "Purchase"]);
});

test("without Google Ads the GA4 event is unchanged; empty env sends nothing", () => {
  browser(true, true);
  boot({ analytics: true, marketing: true }, { ads: null, metaPixel: null });
  assert.equal(window.fbq, undefined);
  assert.equal(track("view_item", viewItem(disc)), true);
  assert.deepEqual(gtagCommands().at(-1), ["event", "view_item", { page_location: "https://getirbakim.com/urun/1", ...viewItem(disc) }]);
  browser(true, true);
  boot({ analytics: true, marketing: true }, { ga4: null, ads: null, metaPixel: null });
  assert.equal(window.gtag, undefined);
  assert.equal(window.fbq, undefined);
  assert.equal(canTrack(), false);
  assert.equal(track("purchase", order), false);
});

test("stopTags revokes the pixel and denies every Google signal", () => {
  browser(true, true);
  boot({ analytics: true, marketing: true });
  stopTags(GA4);
  assert.deepEqual(fbqCommands().at(-1), ["consent", "revoke"]);
  assert.deepEqual(gtagCommands().at(-1), ["consent", "update", consentSignals(null)]);
  assert.equal((window as unknown as Record<string, boolean>)[`ga-disable-${GA4}`], true);
});

test("purchase claim: either consented channel, never an admin; refunds need analytics", () => {
  const consent = (analytics: boolean, marketing: boolean) => serializeConsent({ analytics, marketing, savedAt: now });
  const marketingOnly = { ga4: GA4, marketing: true, role: undefined, consent: consent(false, true), now };
  assert.equal(purchaseClaimAllowed(marketingOnly), true);
  assert.equal(purchaseClaimAllowed({ ...marketingOnly, ga4: null }), true);
  assert.equal(purchaseClaimAllowed({ ...marketingOnly, role: "admin" }), false);
  assert.equal(purchaseClaimAllowed({ ...marketingOnly, consent: consent(false, false) }), false);
  // The server's `marketing` input: a Google Ads id without a purchase label sends no purchase.
  const marketing = (env: Record<string, string>) => {
    const { ads, metaPixel } = analyticsConfig(env);
    return Boolean(ads?.purchaseLabel || metaPixel);
  };
  assert.equal(marketing({ GOOGLE_ADS_ID: ADS.id }), false);
  assert.equal(marketing({ GOOGLE_ADS_ID: ADS.id, GOOGLE_ADS_PURCHASE_LABEL: ADS.purchaseLabel }), true);
  assert.equal(marketing({ META_PIXEL_ID: PIXEL }), true);
  assert.equal(purchaseClaimAllowed({ ...marketingOnly, marketing: marketing({ GOOGLE_ADS_ID: ADS.id }) }), false);
  // Refund path: marketing is false, so only analytics consent opens it.
  const refund = { ga4: GA4, marketing: false, role: undefined, now };
  assert.equal(purchaseClaimAllowed({ ...refund, consent: consent(false, true) }), false);
  assert.equal(purchaseClaimAllowed({ ...refund, consent: consent(true, false) }), true);
});

test("clearTrackingCookies removes only the refused categories' cookies", () => {
  const scope = (analytics: boolean, marketing: boolean) => ({ analytics, marketing });
  for (const name of ["_ga", "_ga_ABC123", "_gid", "_gat", "_gat_UA1"]) {
    assert.equal(trackingCookieRefused(name, scope(false, true)), true, name);
    assert.equal(trackingCookieRefused(name, scope(true, false)), false, name);
  }
  for (const name of ["_gcl_au", "_gcl_aw", "_fbp", "_fbc"]) {
    assert.equal(trackingCookieRefused(name, scope(true, false)), true, name);
    assert.equal(trackingCookieRefused(name, scope(false, true)), false, name);
  }
  assert.equal(trackingCookieRefused("gb_consent", scope(false, false)), false);
  assert.equal(trackingCookieRefused("session", scope(false, false)), false);

  const writes: string[] = [];
  const jar = "_ga=1; _gcl_au=2; _fbp=3; gb_consent=4";
  const fakeDocument = { get cookie() { return jar; }, set cookie(value: string) { writes.push(value); } };
  Object.assign(globalThis, { window: { location: { hostname: "www.getirbakim.com" } }, document: fakeDocument });
  clearTrackingCookies(scope(true, false));
  const cleared = new Set(writes.map(write => write.split("=")[0]));
  assert.deepEqual([...cleared].sort(), ["_fbp", "_gcl_au"]);
  assert.ok(writes.some(write => write.includes("Domain=.getirbakim.com")));
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test("no advertising id is baked in at build", () => {
  for (const file of sources("src")) assert.doesNotMatch(readFileSync(file, "utf8"), /NEXT_PUBLIC_(GOOGLE_ADS|META)/, file);
});
