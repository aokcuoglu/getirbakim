import "server-only";
import { z } from "zod";
import { geliverMode, type GeliverMode } from "./geliver-request";

// Geliver REST client (#960). Own typed fetch, no SDK: @geliver/sdk retries POST /transactions on network errors and
// 5xx (a second paid label) and types its replies as `any`. Every call is made exactly once; the caller decides.
// The token never leaves this module and is never logged.

const BASE_URL = "https://api.geliver.io/api/v1";
const TIMEOUT_MS = 25_000;

export type GeliverConfig = { token: string; mode: GeliverMode };
/** GELIVER_API_TOKEN and GELIVER_MODE; null when no token is set (the Geliver tab is then hidden). */
export function geliverConfig(): GeliverConfig | null {
  const token = process.env.GELIVER_API_TOKEN?.trim();
  return token ? { token, mode: geliverMode(process.env) } : null;
}

export type GeliverResult<T> =
  | { kind: "ok"; data: T }
  /** Geliver answered with result:false and an error code: nothing was done. */
  | { kind: "rejected"; httpStatus: number; code: string; message: string }
  /** No usable answer (timeout, network, 5xx, unreadable body): the request may or may not have been carried out. */
  | { kind: "unknown"; reason: string; httpStatus: number | null };

const errorEnvelope = z.object({ result: z.literal(false), code: z.string().min(1), message: z.string().nullish(), additionalMessage: z.string().nullish() });

/** One request; never retried. `data` validates the envelope's `data` field (a mismatch counts as unknown). */
export async function geliverRequest<T>(config: GeliverConfig, method: "GET" | "POST" | "PUT" | "DELETE", path: string,
  data: z.ZodType<T>, body?: unknown): Promise<GeliverResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { kind: "unknown", reason: timeout ? "Geliver 25 saniyede yanıt vermedi." : "Geliver'e bağlanılamadı.", httpStatus: null };
  }
  let json: unknown;
  try { json = await response.json(); }
  catch { return { kind: "unknown", reason: `Geliver yanıtı okunamadı (HTTP ${response.status}).`, httpStatus: response.status }; }
  if (response.status >= 400 && response.status < 500) {
    const error = errorEnvelope.safeParse(json);
    if (error.success) {
      const message = [error.data.message, error.data.additionalMessage].filter(Boolean).join(" · ");
      return { kind: "rejected", httpStatus: response.status, code: error.data.code, message: message.slice(0, 500) };
    }
  }
  if (!response.ok) return { kind: "unknown", reason: `Geliver beklenmeyen yanıt verdi (HTTP ${response.status}).`, httpStatus: response.status };
  const envelope = z.object({ result: z.literal(true), data }).safeParse(json);
  if (!envelope.success) return { kind: "unknown", reason: `Geliver yanıtı beklenen biçimde değil (HTTP ${response.status}).`, httpStatus: response.status };
  return { kind: "ok", data: envelope.data.data };
}

const text = z.string().nullish();
const trackingStatus = z.object({
  trackingStatusCode: z.string(), trackingSubStatusCode: text, statusDetails: text, statusDate: text, locationName: text, createdAt: text, updatedAt: text,
}).passthrough();
/** The shipment fields read here; the rest of Geliver's large object is kept but not used. */
export const geliverShipment = z.object({
  id: z.string().min(1),
  createdAt: text,
  test: z.boolean().nullish(),
  barcode: text, labelURL: text, responsiveLabelURL: text,
  trackingNumber: text, trackingUrl: text, trackingStatus: trackingStatus.nullish(),
  statusCode: text, providerServiceCode: text,
  hasError: z.boolean().nullish(), lastErrorCode: text, lastErrorMessage: text,
  order: z.object({ orderNumber: text }).passthrough().nullish(),
}).passthrough();
export type GeliverShipment = z.output<typeof geliverShipment>;

const transaction = z.object({ id: z.string().min(1), shipment: geliverShipment }).passthrough();
/** POST /transactions: accepts the service code's offer and buys the label in one call (HTTP 201). */
export const purchaseLabel = (config: GeliverConfig, body: unknown) => geliverRequest(config, "POST", "/transactions", transaction, body);

export const getShipment = (config: GeliverConfig, id: string) => geliverRequest(config, "GET", `/shipments/${encodeURIComponent(id)}`, geliverShipment);

/** Shipments created for an order number, newest first (empty list when none). */
export const findShipmentsByOrderNumber = (config: GeliverConfig, orderNumber: string) =>
  geliverRequest(config, "GET", `/shipments?${new URLSearchParams({ orderNumber, limit: "20" })}`, z.array(geliverShipment).nullable().transform(list => list ?? []));

const webhook = z.object({ id: z.string(), type: z.string(), url: z.string(), headerName: text, headerValue: text, isActive: z.boolean().nullish() }).passthrough();
export type GeliverWebhook = z.output<typeof webhook>;
export const listWebhooks = (config: GeliverConfig) => geliverRequest(config, "GET", "/webhook", z.array(webhook).nullable().transform(list => list ?? []));
/** headerName/headerValue are not in Geliver's documented request; sent anyway, the reply shows whether they were kept. */
export const createWebhook = (config: GeliverConfig, input: { url: string; headerName?: string; headerValue?: string }) =>
  geliverRequest(config, "POST", "/webhook", webhook, { type: "TRACK_UPDATED", ...input });
/** PUT /webhook: Geliver sends a sample TRACK_UPDATED body to the URL. */
export const testWebhook = (config: GeliverConfig, url: string) => geliverRequest(config, "PUT", "/webhook", z.unknown(), { type: "TRACK_UPDATED", url });
export const deleteWebhook = (config: GeliverConfig, id: string) => geliverRequest(config, "DELETE", `/webhook/${encodeURIComponent(id)}`, z.unknown());
