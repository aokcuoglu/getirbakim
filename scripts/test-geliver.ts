import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { provinces } from "../src/modules/store/tr-address";
import { parcelSchema } from "../src/modules/shipping/geliver-parcel";
import {
  buildTransactionBody, eventClock, geliverErrorMessage, geliverMode, geliverTestBlocked, isRepeatEvent, normalizePhone, parseTime, recipientOf, resolveGeliverTrackingUrl, shouldApply, statusTime,
  trackingLook, webhookEventSchema, webhookSecretValid, type GeliverRecipient,
} from "../src/modules/shipping/geliver-request";

// Geliver labels (#960) without a database. No request reaches Geliver: fetch is replaced by a mock that throws unless
// a test installs a reply, and the token is synthetic (.env.local may hold a real one).
process.env.GELIVER_API_TOKEN = "synthetic";
delete process.env.GELIVER_MODE;
const originalFetch = globalThis.fetch;
type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];
let reply: (call: Call) => Promise<Response> = () => { throw new Error("unexpected Geliver call"); };
globalThis.fetch = async (input, init) => { const call = { url: String(input), init }; calls.push(call); return reply(call); };
after(() => { globalThis.fetch = originalFetch; });

const order = {
  customer_name: "Deneme Alıcı", email: "alici@example.invalid", phone: "0532 000 00 00",
  delivery_province: "İstanbul", delivery_district: "Kartal", delivery_address_line: "Deneme Mah. Örnek Sok. No 1",
};

test("every province maps to its two-digit Geliver city code", () => {
  assert.equal(provinces.length, 81);
  for (const province of provinces) {
    const result = recipientOf({ ...order, delivery_province: province.name, delivery_district: province.districts[0] });
    assert.ok(result.ok, province.name);
    assert.match(result.address.cityCode, /^\d{2}$/);
    assert.equal(Number(result.address.cityCode), province.plate);
  }
  const city = (name: string) => { const r = recipientOf({ ...order, delivery_province: name, delivery_district: provinces.find(p => p.name === name)!.districts[0] }); return r.ok ? r.address.cityCode : null; };
  assert.equal(city("Adana"), "01");
  assert.equal(city("İstanbul"), "34");
});

test("orders without a usable address or phone are refused with a reason", () => {
  assert.deepEqual(recipientOf({ ...order, delivery_province: null, delivery_district: null, delivery_address_line: null }), { ok: false, reason: "no_structured_address" });
  assert.deepEqual(recipientOf({ ...order, delivery_address_line: "  " }), { ok: false, reason: "no_structured_address" });
  assert.deepEqual(recipientOf({ ...order, delivery_province: "Atlantis" }), { ok: false, reason: "province" });
  assert.deepEqual(recipientOf({ ...order, delivery_district: "Çankaya" }), { ok: false, reason: "district" });
  assert.deepEqual(recipientOf({ ...order, phone: "12345" }), { ok: false, reason: "phone" });
  const ok = recipientOf(order);
  assert.ok(ok.ok);
  assert.deepEqual(ok.address, { name: "Deneme Alıcı", email: "alici@example.invalid", phone: "+905320000000", address1: "Deneme Mah. Örnek Sok. No 1",
    countryCode: "TR", cityCode: "34", districtName: "Kartal" });
});

test("phone numbers are normalised to +90 and ten digits", () => {
  for (const input of ["05320000000", "5320000000", "+90 532 000 00 00", "0090 (532) 000-0000", "90 532 000 0000"]) assert.equal(normalizePhone(input), "+905320000000", input);
  assert.equal(normalizePhone("0216 000 00 00"), "+902160000000");
  for (const input of ["", "12345", "0532000000", "+1 202 555 0100", "01320000000"]) assert.equal(normalizePhone(input), null, input);
});

test("the mode is live only when GELIVER_MODE is exactly live", () => {
  assert.equal(geliverMode({}), "test");
  assert.equal(geliverMode({ GELIVER_MODE: "LIVE" }), "test");
  assert.equal(geliverMode({ GELIVER_MODE: "production" }), "test");
  assert.equal(geliverMode({ GELIVER_MODE: "live" }), "live");
});

const recipient: GeliverRecipient = { name: "A", email: "a@example.invalid", phone: "+905320000000", address1: "Adres", countryCode: "TR", cityCode: "34", districtName: "Kartal" };
test("the transaction body follows the verified request (test and live)", () => {
  const parcel = parcelSchema.parse({ preset: "medium" });
  const input = { order: { number: "1042", total_kurus: "123456" }, recipient, lines: [{ name: "Yağ filtresi", quantity: 2 }], parcel, siteUrl: "https://example.invalid" };
  const testBody = buildTransactionBody({ ...input, mode: "test" });
  assert.deepEqual(testBody, {
    providerServiceCode: "GELIVER_STANDART",
    shipment: {
      test: true, recipientAddress: recipient, length: "30", width: "25", height: "15", distanceUnit: "cm", weight: "3", massUnit: "kg",
      items: [{ title: "Yağ filtresi", quantity: 2 }], productPaymentOnDelivery: false, hidePackageContentOnTag: false,
      order: { sourceCode: "API", sourceIdentifier: "https://example.invalid", orderNumber: "TEST-1042", totalAmount: 1234.56, totalAmountCurrency: "TL" },
    },
  });
  assert.ok(!("senderAddressID" in testBody.shipment));
  const live = buildTransactionBody({ ...input, mode: "live" });
  assert.equal(live.providerServiceCode, "YURTICI_STANDART");
  assert.equal(live.shipment.test, false);
  assert.equal(live.shipment.order.orderNumber, "1042");
});

test("parcel presets and custom sizes are validated", () => {
  assert.deepEqual(parcelSchema.parse({ preset: "small" }), { preset: "small", length: 20, width: 15, height: 10, weight: 1 });
  assert.deepEqual(parcelSchema.parse({ preset: "large" }), { preset: "large", length: 50, width: 40, height: 30, weight: 10 });
  assert.deepEqual(parcelSchema.parse({ preset: "custom", length: "40", width: "30,5", height: " 20 ", weight: "2,25" }),
    { preset: "custom", length: 40, width: 30.5, height: 20, weight: 2.25 });
  const bad = parcelSchema.safeParse({ preset: "custom", length: "0", width: "201", height: "x", weight: "0.05" });
  assert.ok(!bad.success);
  const errors = bad.error.flatten().fieldErrors as Record<string, string[]>;
  assert.equal(errors.length[0], "Uzunluk en az 1 cm olmalı.");
  assert.equal(errors.width[0], "Genişlik en fazla 200 cm olabilir.");
  assert.equal(errors.height[0], "Yükseklik sayı olmalı.");
  assert.equal(errors.weight[0], "Ağırlık en az 0.1 kg olmalı.");
  assert.ok(!parcelSchema.safeParse({ preset: "huge" }).success);
  assert.ok(!parcelSchema.safeParse({}).success);
});

test("Geliver error codes become admin messages that keep manual shipping open", () => {
  assert.match(geliverErrorMessage("E1066", "x"), /bakiyesi yetersiz/);
  assert.match(geliverErrorMessage("E1134", "x"), /alıcı telefonu/);
  assert.match(geliverErrorMessage("E1132", "x"), /alıcı ilçesi/);
  assert.match(geliverErrorMessage("E1055", "x"), /API anahtarı veya izinli IP/);
  assert.match(geliverErrorMessage("E1068", "x"), /gönderici adresini/);
  assert.match(geliverErrorMessage("E1072", "x"), /etiketini oluşturamadı/);
  assert.equal(geliverErrorMessage("E9999", "Bir şey oldu"), "Geliver isteği reddetti (E9999): Bir şey oldu. Elle sevk hâlâ kullanılabilir.");
  assert.equal(geliverErrorMessage("LOCAL_NO_LABEL", null), "Geliver'de etiketi alınmamış bir gönderi var; Geliver panelini kontrol edin. Elle sevk hâlâ kullanılabilir.");
  assert.equal(geliverErrorMessage("LOCAL_NOT_FOUND", null), "Geliver'de gönderi oluşmamış; yeniden deneyebilirsiniz. Elle sevk hâlâ kullanılabilir.");
  for (const code of ["E1066", "E1129", "E1055", "E1068", "E1071", "E9999", "LOCAL_NO_LABEL", "LOCAL_NOT_FOUND"]) assert.ok(geliverErrorMessage(code, "m").endsWith("Elle sevk hâlâ kullanılabilir."), code);
});

test("tracking statuses have a label and tone", () => {
  assert.deepEqual(trackingLook(null, null), { label: "Etiket oluşturuldu", tone: "info" });
  assert.deepEqual(trackingLook("PRE_TRANSIT", "information_received"), { label: "Kargoya verilmeyi bekliyor", tone: "info" });
  assert.equal(trackingLook("PRE_TRANSIT", "pickup_failed").tone, "warning");
  assert.deepEqual(trackingLook("TRANSIT", "package_accepted"), { label: "Yolda", tone: "info" });
  assert.equal(trackingLook("TRANSIT", "out_for_delivery").label, "Dağıtımda");
  assert.deepEqual(trackingLook("DELIVERED", "delivered"), { label: "Teslim edildi", tone: "success" });
  assert.equal(trackingLook("FAILURE", "package_lost").tone, "error");
  assert.equal(trackingLook("RETURNED", "return_to_sender").tone, "warning");
  assert.equal(trackingLook("CANCELED", "package_canceled").tone, "error");
  assert.equal(trackingLook("SOMETHING_NEW", null).tone, "neutral");
});

test("the tracking link prefers Yurtiçi's page for a real number, then Geliver's link, then Geliver's page", () => {
  const shipmentId = "00000000-0000-4000-8000-000000000001";
  const geliverPage = `https://app.geliver.io/tracking/${shipmentId}`;
  assert.equal(resolveGeliverTrackingUrl({ test: false, shipmentId, trackingNumber: "123456789012", trackingUrl: "https://example.invalid/t" }),
    "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=123456789012");
  assert.equal(resolveGeliverTrackingUrl({ test: false, shipmentId, trackingNumber: "12345678", trackingUrl: "https://example.invalid/t" }), "https://example.invalid/t");
  assert.equal(resolveGeliverTrackingUrl({ test: false, shipmentId, trackingNumber: "12345678", trackingUrl: "http://example.invalid/t" }), geliverPage);
  assert.equal(resolveGeliverTrackingUrl({ test: false, shipmentId, trackingNumber: null, trackingUrl: null }), geliverPage);
  assert.equal(resolveGeliverTrackingUrl({ test: true, shipmentId, trackingNumber: "1234567890123456", trackingUrl: "https://example.invalid/t" }), geliverPage);
});

// The documented test body (docs.geliver.io/docs/webhooks/test_webhook): statusDate null.
const docSample = {
  event: "TRACK_UPDATED", metadata: "",
  data: {
    id: "186af322-c9ad-407c-b798-64d464816cf4", createdAt: "0001-01-01T00:00:00Z",
    trackingStatus: { id: "3b8ecf37-4e9d-4b73-aed5-13abcdc427e0", createdAt: "2026-05-12T16:49:33.000194603Z", updatedAt: "2026-05-12T16:49:33.000194653Z",
      trackingStatusCode: "DELIVERED", trackingSubStatusCode: "delivered", statusDetails: "Teslim Edildi", statusDate: null, locationName: "Sarnıç Mikro",
      locationLat: null, locationLng: null, hash: null },
    trackingNumber: "123123123", trackingUrl: "http://xxx.com/123123123", labelFileType: "", orderID: null, order: null, recipientAddress: null,
  },
};
/** A TRACK_UPDATED event; `updatedAt` is Geliver's record time, `statusDate` the carrier's. */
const event = (code: string, sub: string | null, updatedAt: string | null, statusDate: string | null = null) => webhookEventSchema.parse({
  event: "TRACK_UPDATED", data: { id: "s1", trackingStatus: { trackingStatusCode: code, trackingSubStatusCode: sub, statusDate, updatedAt } },
});

test("webhook bodies parse; events are ordered by Geliver's clock, statusDate is only the carrier's time", () => {
  const parsed = webhookEventSchema.parse(docSample);
  assert.equal(parsed.data.id, "186af322-c9ad-407c-b798-64d464816cf4");
  assert.equal(parsed.data.trackingStatus?.trackingStatusCode, "DELIVERED");
  assert.equal(eventClock(parsed)?.toISOString(), "2026-05-12T16:49:33.000Z");
  assert.equal(statusTime(parsed), null);
  const mixed = event("TRANSIT", null, "2026-11-18T21:25:05.948898+03:00", "2026-11-18T09:00:00Z");
  assert.equal(eventClock(mixed)?.toISOString(), "2026-11-18T18:25:05.948Z");
  assert.equal(statusTime(mixed)?.toISOString(), "2026-11-18T09:00:00.000Z");
  assert.equal(eventClock(event("TRANSIT", null, "0001-01-01T00:00:00Z")), null);
  assert.equal(parseTime("not a date"), null);
  assert.equal(parseTime("1999-12-31T23:59:59Z"), null);
  assert.ok(!webhookEventSchema.safeParse({ event: "TRACK_UPDATED", data: {} }).success);
  assert.ok(!webhookEventSchema.safeParse({ trackingStatus: {} }).success);
});

test("only newer or different statuses are applied, by Geliver's clock", () => {
  const stored = { tracking_status_code: "TRANSIT", tracking_sub_status_code: "package_accepted", tracking_updated_at: new Date("2026-11-18T10:00:00Z") };
  assert.equal(shouldApply({ tracking_status_code: null, tracking_sub_status_code: null, tracking_updated_at: null }, event("PRE_TRANSIT", null, null)), true);
  assert.equal(shouldApply(stored, event("TRANSIT", "package_accepted", "2026-11-18T10:00:00Z")), false, "repeat");
  assert.equal(shouldApply(stored, event("PRE_TRANSIT", "information_received", "2026-11-18T09:00:00Z")), false, "older");
  assert.equal(shouldApply(stored, event("TRANSIT", "out_for_delivery", "2026-11-18T11:00:00Z")), true);
  assert.equal(shouldApply(stored, event("TRANSIT", "package_accepted", null)), false, "same status without time");
  assert.equal(shouldApply(stored, event("DELIVERED", "delivered", null)), true);
  // Mixed clocks: an earlier carrier statusDate does not make a later Geliver record stale.
  assert.equal(shouldApply(stored, event("DELIVERED", "delivered", "2026-11-18T10:30:00Z", "2026-11-18T09:30:00Z")), true);
  // A late statusDate does not make an older Geliver record fresh.
  assert.equal(shouldApply(stored, event("PRE_TRANSIT", null, "2026-11-18T09:30:00Z", "2026-11-18T12:00:00Z")), false);
  assert.equal(shouldApply(stored, webhookEventSchema.parse({ event: "TRACK_UPDATED", data: { id: "s1", trackingStatus: null } })), false);
});

test("only an exact repeat counts as a duplicate, older events are not", () => {
  const stored = { tracking_status_code: "TRANSIT", tracking_sub_status_code: "package_accepted", tracking_updated_at: new Date("2026-11-18T10:00:00Z") };
  assert.equal(isRepeatEvent(stored, event("TRANSIT", "package_accepted", "2026-11-18T10:00:00Z")), true);
  assert.equal(isRepeatEvent(stored, event("TRANSIT", "package_accepted", null)), true, "same status without time");
  assert.equal(isRepeatEvent(stored, event("TRANSIT", "package_accepted", "2026-11-18T09:00:00Z")), false, "older is stale");
  assert.equal(isRepeatEvent(stored, event("TRANSIT", "out_for_delivery", "2026-11-18T10:00:00Z")), false);
  assert.equal(isRepeatEvent({ tracking_status_code: null, tracking_sub_status_code: null, tracking_updated_at: null }, event("TRANSIT", null, null)), false);
});

test("test mode is refused on a production server unless explicitly allowed", () => {
  assert.equal(geliverTestBlocked({ NODE_ENV: "production" }), true);
  assert.equal(geliverTestBlocked({ NODE_ENV: "production", GELIVER_MODE: "test" }), true);
  assert.equal(geliverTestBlocked({ NODE_ENV: "production", GELIVER_ALLOW_TEST_IN_PRODUCTION: "1" }), false);
  assert.equal(geliverTestBlocked({ NODE_ENV: "production", GELIVER_MODE: "live" }), false);
  assert.equal(geliverTestBlocked({ NODE_ENV: "development" }), false, "next dev keeps test mode");
  assert.equal(geliverTestBlocked({}), false);
});

test("the webhook secret matches the header or the token, never a short secret", () => {
  const secret = "s".repeat(40);
  assert.equal(webhookSecretValid({ secret, header: secret, token: null }), "header");
  assert.equal(webhookSecretValid({ secret, header: null, token: secret }), "token");
  assert.equal(webhookSecretValid({ secret, header: "wrong", token: secret }), "token");
  assert.equal(webhookSecretValid({ secret, header: "wrong", token: "s".repeat(39) }), null);
  assert.equal(webhookSecretValid({ secret, header: null, token: null }), null);
  assert.equal(webhookSecretValid({ secret: "short", header: "short", token: "short" }), null);
  assert.equal(webhookSecretValid({ secret: undefined, header: "", token: "" }), null);
});

const shipmentReply = { id: "tx-1", shipment: { id: "sh-1", barcode: "000", labelURL: "https://labels.example.invalid/sh-1.pdf", trackingStatus: null, test: true } };
test("geliverRequest: one call, bearer token, and replies classified as ok, rejected or unknown", async () => {
  const { geliverConfig, purchaseLabel } = await import("../src/modules/shipping/geliver");
  const config = geliverConfig();
  assert.deepEqual(config, { token: "synthetic", mode: "test" });
  const run = async (response: () => Promise<Response>) => {
    calls.length = 0;
    reply = response;
    const result = await purchaseLabel(config!, { providerServiceCode: "GELIVER_STANDART" });
    assert.equal(calls.length, 1, "exactly one fetch, never retried");
    return result;
  };
  const ok = await run(async () => Response.json({ result: true, message: "Success", data: shipmentReply }, { status: 201 }));
  assert.equal(ok.kind, "ok");
  assert.equal(calls[0].url, "https://api.geliver.io/api/v1/transactions");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer synthetic");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { providerServiceCode: "GELIVER_STANDART" });

  const rejected = await run(async () => Response.json({ result: false, code: "E1066", message: "Bakiye yetersiz", additionalMessage: "balance" }, { status: 400 }));
  assert.deepEqual(rejected, { kind: "rejected", httpStatus: 400, code: "E1066", message: "Bakiye yetersiz · balance" });
  assert.equal((await run(async () => Response.json({ result: false, code: "E1055", message: "Yetki yok" }, { status: 401 }))).kind, "rejected");

  assert.equal((await run(async () => Response.json({ result: false, code: "E1086" }, { status: 502 }))).kind, "unknown");
  assert.equal((await run(async () => new Response("<html>bad gateway</html>", { status: 200 }))).kind, "unknown");
  assert.equal((await run(async () => Response.json({ result: true, data: { id: "tx-1", shipment: {} } }, { status: 201 }))).kind, "unknown", "no shipment id");
  assert.equal((await run(async () => Response.json({ message: "nope" }, { status: 400 }))).kind, "unknown", "4xx without an error code");
  const timeout = await run(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); });
  assert.deepEqual(timeout, { kind: "unknown", reason: "Geliver 25 saniyede yanıt vermedi.", httpStatus: null });
  assert.equal((await run(async () => { throw new TypeError("fetch failed"); })).kind, "unknown");
  reply = () => { throw new Error("unexpected Geliver call"); };
});

test("no code reads the production Geliver token", () => {
  const forbidden = ["GELIVER_API", "PROD_TOKEN"].join("_");
  let found = "";
  try { found = execFileSync("git", ["grep", "-l", forbidden, "--", "src", "scripts", ":!scripts/test-geliver.ts"], { encoding: "utf8" }); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  assert.equal(found.trim(), "");
});
