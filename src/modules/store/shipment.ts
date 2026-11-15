import { z } from "zod";

// Carriers offered in the admin's ship dialog (#605), in display order. trackingUrl builds the carrier's public tracking page;
// null where no stable query link is known (checked 2026-11-15: PTT's link redirects to its home page), so the customer is
// told to search. Yurtiçi's page reads `code` from the query string and runs the search (its shipment-tracking.js).
export const carriers = {
  yurtici: { label: "Yurtiçi Kargo", trackingUrl: (no: string) => `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${no}` },
  aras: { label: "Aras Kargo", trackingUrl: (no: string) => `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${no}` },
  mng: { label: "MNG Kargo (DHL eCommerce)", trackingUrl: null },
  ptt: { label: "PTT Kargo", trackingUrl: null },
  surat: { label: "Sürat Kargo", trackingUrl: null },
  ups: { label: "UPS", trackingUrl: (no: string) => `https://www.ups.com/track?loc=tr_TR&tracknum=${no}` },
  hepsijet: { label: "HepsiJET", trackingUrl: null },
  kolaygelsin: { label: "Kolay Gelsin", trackingUrl: null },
  other: { label: "Diğer", trackingUrl: null },
} satisfies Record<string, { label: string; trackingUrl: ((no: string) => string) | null }>;
export type CarrierCode = keyof typeof carriers;
export const carrierCodes = Object.keys(carriers) as [CarrierCode, ...CarrierCode[]];

/** The store ships with Yurtiçi Kargo (2026-11-15 decision); the ship dialog starts on it and it leads the list. */
export const defaultCarrier: CarrierCode = "yurtici";
/** Carrier the ship dialog starts on: the recorded one, else the default. */
export const startingCarrier = (stored: string | null | undefined) => stored || defaultCarrier;

const isCarrier = (value: string): value is CarrierCode => Object.hasOwn(carriers, value);

/** Name shown for an order's carrier; null when none was recorded. */
export function carrierLabel(carrier: string | null, carrierName: string | null) {
  if (!carrier) return null;
  if (carrier === "other") return carrierName || carriers.other.label;
  return isCarrier(carrier) ? carriers[carrier].label : carrier;
}

const httpsUrl = z.url({ protocol: /^https$/ });
// Yurtiçi's own tracking page accepts only these (2026-11-15 decision); other carriers keep the general rule.
const yurticiTrackingNo = /^(\d{12}|\d{16})$/;
export const yurticiTrackingRule = "Yurtiçi Kargo takip numarası 12 veya 16 haneli olmalı.";

export const shipmentSchema = z.object({
  carrier: z.enum(carrierCodes, "Kargo firmasını seçin."),
  carrierName: z.string().trim().max(60, "Firma adı en fazla 60 karakter olabilir.").optional(),
  // Labels often print the number in groups; spaces are not part of it.
  trackingNo: z.string("Takip numarasını girin.").transform(value => value.replace(/\s+/g, "")).pipe(z.string()
    .min(4, "Takip numarası en az 4 karakter olmalı.").max(40, "Takip numarası en fazla 40 karakter olabilir.")
    .regex(/^[A-Za-z0-9-]+$/, "Takip numarasında yalnız harf, rakam ve tire kullanılabilir.")),
  trackingUrl: z.string().trim().max(500, "Bağlantı en fazla 500 karakter olabilir.").optional()
    .refine(value => !value || (value.startsWith("https://") && httpsUrl.safeParse(value).success), "Bağlantı https:// ile başlayan geçerli bir adres olmalı."),
}).superRefine((value, context) => {
  if (value.carrier === "other" && (value.carrierName ?? "").length < 2) {
    context.addIssue({ code: "custom", path: ["carrierName"], message: "Kargo firmasının adını girin." });
  }
  if (value.carrier === "yurtici" && !yurticiTrackingNo.test(value.trackingNo)) {
    context.addIssue({ code: "custom", path: ["trackingNo"], message: yurticiTrackingRule });
  }
}).transform(value => ({
  carrier: value.carrier,
  carrierName: value.carrier === "other" ? value.carrierName ?? null : null,
  trackingNo: value.trackingNo,
  trackingUrl: value.trackingUrl || null,
}));
export type Shipment = z.output<typeof shipmentSchema>;
/** `next`: on success, the order list (same tab, sort and page) to return to. */
export type ShipmentResult = { status: "idle" | "error" | "success"; errors?: Record<string, string[] | undefined>; message?: string; next?: string };

/** Whether the carrier's tracking link can be built from the number alone. */
export const hasTrackingTemplate = (carrier: string) => isCarrier(carrier) && carriers[carrier].trackingUrl !== null;

/** Link stored with the order: the admin's own https link, else the carrier's template, else none. */
export function resolveTrackingUrl(carrier: string, trackingNo: string, manualUrl: string | null) {
  if (manualUrl) return manualUrl;
  const template = isCarrier(carrier) ? carriers[carrier].trackingUrl : null;
  return template && trackingNo ? template(encodeURIComponent(trackingNo)) : null;
}
