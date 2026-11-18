import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { findProvince } from "@/modules/store/tr-address";
import type { Parcel } from "./geliver-parcel";
import { resolveTrackingUrl } from "@/modules/store/shipment";
import type { StatusTone } from "@/modules/suppliers/run-status";

// Geliver label requests (#960), free of the database and the network so tests can cover them. Verified against the
// Geliver API on 18 Nov 2026 (docs/commerce.md, "Geliver ile kargo etiketi").

export type GeliverMode = "test" | "live";
/** Real (paid) Yurtiçi labels only when GELIVER_MODE is exactly `live`; anything else buys free test labels. */
export const geliverMode = (env: Record<string, string | undefined>): GeliverMode => env.GELIVER_MODE === "live" ? "live" : "test";
/** Test labels go through Geliver's own test carrier; live ones through Yurtiçi Kargo. */
/**
 * A production server in test mode would mark real orders shipped with free test labels that never move: refused unless
 * GELIVER_ALLOW_TEST_IN_PRODUCTION=1. `next dev` (NODE_ENV=development) keeps test mode.
 */
export const geliverTestBlocked = (env: Record<string, string | undefined>) =>
  env.NODE_ENV === "production" && geliverMode(env) === "test" && env.GELIVER_ALLOW_TEST_IN_PRODUCTION !== "1";
export const geliverTestBlockedMessage = "Geliver test modunda; canlı etiket için GELIVER_MODE=live ayarlanmalı.";
export const serviceCodeFor = (mode: GeliverMode) => mode === "live" ? "YURTICI_STANDART" : "GELIVER_STANDART";
/** Order number sent to Geliver; test labels are kept apart from the live ones of the same order. */
export const geliverOrderNumber = (number: string, test: boolean) => test ? `TEST-${number}` : number;

/** A Turkish phone number as Geliver takes it (+90 and 10 digits); null when the order's free-form number is not one. */
export function normalizePhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[2-58]\d{9}$/.test(digits) ? `+90${digits}` : null;
}

export type RecipientOrder = {
  customer_name: string; email: string; phone: string;
  delivery_province: string | null; delivery_district: string | null; delivery_address_line: string | null;
};
export type GeliverRecipient = { name: string; email: string; phone: string; address1: string; countryCode: "TR"; cityCode: string; districtName: string };
export type RecipientBlock = "no_structured_address" | "province" | "district" | "phone";

/**
 * Geliver's recipient from the order's structured address (#881). City codes are the licence plate codes and district
 * names are spelled as in tr-provinces.json (all 81 provinces and 973 districts match Geliver's /cities and /districts).
 */
export function recipientOf(order: RecipientOrder): { ok: true; address: GeliverRecipient } | { ok: false; reason: RecipientBlock } {
  if (!order.delivery_province || !order.delivery_district || !order.delivery_address_line?.trim()) return { ok: false, reason: "no_structured_address" };
  const province = findProvince(order.delivery_province);
  if (!province) return { ok: false, reason: "province" };
  if (!province.districts.includes(order.delivery_district)) return { ok: false, reason: "district" };
  const phone = normalizePhone(order.phone);
  if (!phone) return { ok: false, reason: "phone" };
  return { ok: true, address: {
    name: order.customer_name.trim(), email: order.email.trim(), phone, address1: order.delivery_address_line.trim(), countryCode: "TR",
    cityCode: String(province.plate).padStart(2, "0"), districtName: order.delivery_district,
  } };
}

/** Why the Geliver tab of the ship dialog cannot be used for an order; manual shipping stays available. */
export const recipientBlockLabel: Record<RecipientBlock, string> = {
  no_structured_address: "Bu siparişte yapılandırılmış adres yok; Geliver etiketi oluşturulamaz. Elle giriş sekmesinden kargoya verin.",
  province: "Siparişin ili tanınmadı; Geliver etiketi oluşturulamaz. Elle giriş sekmesinden kargoya verin.",
  district: "Siparişin ilçesi il ile eşleşmiyor; Geliver etiketi oluşturulamaz. Elle giriş sekmesinden kargoya verin.",
  phone: "Siparişteki telefon numarası Türkiye numarası olarak okunamadı; Geliver etiketi oluşturulamaz. Elle giriş sekmesinden kargoya verin.",
};

export type TransactionInput = {
  order: { number: string; total_kurus: string | number };
  recipient: GeliverRecipient;
  lines: { name: string; quantity: number }[];
  parcel: Parcel;
  mode: GeliverMode;
  siteUrl: string;
};

/** POST /transactions body: one offer for the service code accepted and its label bought in a single call. */
export function buildTransactionBody({ order, recipient, lines, parcel, mode, siteUrl }: TransactionInput) {
  const test = mode !== "live";
  return {
    providerServiceCode: serviceCodeFor(mode),
    shipment: {
      test,
      recipientAddress: recipient,
      length: String(parcel.length), width: String(parcel.width), height: String(parcel.height), distanceUnit: "cm",
      weight: String(parcel.weight), massUnit: "kg",
      items: lines.map(line => ({ title: line.name.slice(0, 200), quantity: line.quantity })),
      productPaymentOnDelivery: false,
      hidePackageContentOnTag: false,
      order: {
        sourceCode: "API", sourceIdentifier: siteUrl, orderNumber: geliverOrderNumber(order.number, test),
        totalAmount: Number(order.total_kurus) / 100, totalAmountCurrency: "TL",
      },
    },
  };
}

const manualHint = "Elle sevk hâlâ kullanılabilir.";
const recipientErrors: Record<string, string> = {
  E1129: "alıcı adresi", E1130: "alıcı ili", E1131: "alıcı ülkesi", E1132: "alıcı ilçesi", E1133: "alıcı adı", E1134: "alıcı telefonu", E1136: "alıcı e-posta adresi",
};
/** What the admin is told when Geliver refuses a request (its documented error codes). */
export function geliverErrorMessage(code: string | null, message: string | null) {
  if (code && recipientErrors[code]) return `Geliver ${recipientErrors[code]} bilgisini kabul etmedi; siparişin adres bilgilerini kontrol edin. ${manualHint}`;
  switch (code) {
    case "E1066": return `Geliver bakiyesi yetersiz; Geliver panelinden bakiye yükleyip yeniden deneyin. ${manualHint}`;
    case "E1055": return `Geliver isteği yetkisiz buldu (API anahtarı veya izinli IP); teknik ekibe bildirin. ${manualHint}`;
    case "E1068": return `Geliver gönderici adresini bulamadı; Geliver panelinde varsayılan gönderici adresini kontrol edin. ${manualHint}`;
    case "E1071": case "E1072": return `Geliver kargo etiketini oluşturamadı; biraz sonra yeniden deneyin. ${manualHint}`;
    default: return `Geliver isteği reddetti (${code ?? "kod yok"}): ${message ?? "açıklama yok"}. ${manualHint}`;
  }
}

/** Badge of a Geliver tracking status (trackingStatusCode / trackingSubStatusCode); null before the first status. */
export function trackingLook(code: string | null, sub: string | null): { label: string; tone: StatusTone } {
  switch (code) {
    case null: case "": return { label: "Etiket oluşturuldu", tone: "info" };
    case "PRE_TRANSIT":
      return sub === "pickup_failed" ? { label: "Kurye teslim alamadı", tone: "warning" } : { label: "Kargoya verilmeyi bekliyor", tone: "info" };
    case "TRANSIT":
      if (sub === "out_for_delivery") return { label: "Dağıtımda", tone: "info" };
      if (sub === "package_damaged") return { label: "Paket hasarlı", tone: "warning" };
      if (sub === "delivery_rescheduled") return { label: "Dağıtım zamanı değişti", tone: "warning" };
      return { label: "Yolda", tone: "info" };
    case "DELIVERED": return { label: "Teslim edildi", tone: "success" };
    case "FAILURE": return sub === "package_lost" ? { label: "Paket kayboldu", tone: "error" } : { label: "Teslim edilemiyor", tone: "error" };
    case "RETURNED": return { label: "Göndericiye iade edildi", tone: "warning" };
    case "CANCELED": return { label: "Kargo iptal edildi", tone: "error" };
    default: return { label: "Bilinmeyen kargo durumu", tone: "neutral" };
  }
}

const geliverTrackingPage = (shipmentId: string) => `https://app.geliver.io/tracking/${encodeURIComponent(shipmentId)}`;
/**
 * Customer tracking link of a Geliver label: Yurtiçi's own page once a real 12/16-digit number is known, else Geliver's
 * https link of a live label, else Geliver's tracking page of the shipment. Test labels never link to a carrier.
 */
export function resolveGeliverTrackingUrl({ test, shipmentId, trackingNumber, trackingUrl }: {
  test: boolean; shipmentId: string; trackingNumber: string | null | undefined; trackingUrl: string | null | undefined;
}) {
  if (!test && trackingNumber && /^(\d{12}|\d{16})$/.test(trackingNumber)) return resolveTrackingUrl("yurtici", trackingNumber, null);
  if (!test && trackingUrl && /^https:\/\/[^\s]+$/.test(trackingUrl) && trackingUrl.length <= 500) return trackingUrl;
  return geliverTrackingPage(shipmentId);
}

const optionalText = z.string().nullish();
/** TRACK_UPDATED body: `{event, metadata, data: <shipment>}`; only the fields read here are checked. */
export const webhookEventSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.string().min(1),
    test: z.boolean().nullish(),
    trackingNumber: optionalText,
    trackingUrl: optionalText,
    trackingStatus: z.object({
      trackingStatusCode: z.string().min(1),
      trackingSubStatusCode: optionalText,
      statusDetails: optionalText,
      statusDate: optionalText,
      locationName: optionalText,
      createdAt: optionalText,
      updatedAt: optionalText,
    }).passthrough().nullish(),
  }).passthrough(),
}).passthrough();
export type WebhookEvent = z.output<typeof webhookEventSchema>;

/** A Geliver time; null when missing, unreadable or a zero value such as 0001-01-01. */
export function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) || time.getUTCFullYear() < 2000 ? null : time;
}
/**
 * When Geliver recorded the status (updatedAt, else createdAt): the one clock events are ordered by. statusDate is the
 * carrier's own time, may be missing or late-reported, and is only shown and used as the delivery time.
 */
export function eventClock(event: WebhookEvent) {
  const status = event.data.trackingStatus;
  return parseTime(status?.updatedAt) ?? parseTime(status?.createdAt);
}
/** The carrier's time of the status (statusDate); null if unusable. */
export const statusTime = (event: WebhookEvent) => parseTime(event.data.trackingStatus?.statusDate);

export type StoredTracking = { tracking_status_code: string | null; tracking_sub_status_code: string | null; tracking_updated_at: Date | null };
/** Whether an event changes what is stored: repeats (same status, same Geliver time) and older events are skipped. */
export function shouldApply(current: StoredTracking, event: WebhookEvent) {
  const status = event.data.trackingStatus;
  if (!status) return false;
  if (!current.tracking_status_code) return true;
  const at = eventClock(event);
  const same = current.tracking_status_code === status.trackingStatusCode && (current.tracking_sub_status_code ?? null) === (status.trackingSubStatusCode ?? null);
  if (at && current.tracking_updated_at) {
    if (at.getTime() < current.tracking_updated_at.getTime()) return false;
    return !(same && at.getTime() === current.tracking_updated_at.getTime());
  }
  return !same;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
/**
 * Which carrier of the webhook secret matched (the X-Geliver-Secret header or the `token` query parameter); null when
 * none did or the secret is unset or shorter than 32 characters. Compared in constant time.
 */
export function webhookSecretValid({ secret, header, token }: { secret: string | undefined; header: string | null; token: string | null }): "header" | "token" | null {
  if (!secret || secret.length < 32) return null;
  const expected = digest(secret);
  if (header && timingSafeEqual(digest(header), expected)) return "header";
  if (token && timingSafeEqual(digest(token), expected)) return "token";
  return null;
}
