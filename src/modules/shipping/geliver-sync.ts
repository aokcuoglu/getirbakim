import "server-only";
import { db } from "@/lib/db";
import { applyTrackingUpdate } from "./geliver-labels";
import { geliverConfig, getShipment, type GeliverResult, type GeliverShipment } from "./geliver";
import { geliverMode, webhookEventSchema } from "./geliver-request";

// Periodic Geliver tracking sync (#974): a missed TRACK_UPDATED webhook (an event before the shipment id was stored is
// ignored as unknown_shipment; Geliver's retries are undocumented) must not leave a delivered order "shipped" forever.
// Live labels of shipped orders are fetched one by one (GET /shipments/{id}) and the reply goes through the webhook's
// own applyTrackingUpdate, so ordering, duplicate, stale and tracking-number rules stay identical. Test labels are never
// fetched: a GET advances a test shipment. Run by `npm run geliver:sync` (docs/commerce.md).

export const SYNC_DEFAULT_LIMIT = 50;
export const SYNC_DEFAULT_MIN_AGE_MINUTES = 60;
/** Labels bought longer ago are left alone: a shipment still "shipped" after this long (returned, failed, cancelled or
 * unknown to Geliver) is for operations, not for every run's budget. */
export const SYNC_MAX_LABEL_AGE_DAYS = 60;
/** The run stops after this many failed calls in a row (Geliver down or refusing). */
const MAX_CONSECUTIVE_ERRORS = 3;
const DEFAULT_PAUSE_MS = 300;

export type GeliverSyncCandidate = { rowId: string; orderId: string; shipmentId: string; checkedAt: Date | null; trackingStatusCode: string | null };
export type GeliverSyncResult = GeliverSyncCandidate & (
  | { outcome: "applied"; statusCode: string }
  | { outcome: "ignored"; reason: "unknown_shipment" | "stale" | "duplicate" }
  /** Geliver answered without a tracking status: nothing to apply yet. */
  | { outcome: "no_status" }
  /** Refused, unanswered or unexpected reply: the row keeps everything but checked_at. */
  | { outcome: "error"; reason: string }
);
export type GeliverSyncSummary =
  | { status: "not_live" }
  | { status: "unavailable" }
  | { status: "done"; dryRun: true; candidates: GeliverSyncCandidate[] }
  /**
   * `aborted`: the run stopped early, on a refused token/IP (401 or E1055) or after three failed calls in a row; labels
   * not called keep their checked_at. `failed`: aborted, or every call failed; the CLI then exits 1.
   */
  | { status: "done"; dryRun: false; results: GeliverSyncResult[]; aborted: "unauthorized" | "consecutive_errors" | null; failed: boolean };

type CandidateRow = { id: string; order_id: string; geliver_shipment_id: string; previous: Date | null; tracking_status_code: string | null };

// Purchased live labels (bought within SYNC_MAX_LABEL_AGE_DAYS) of orders still on their way, oldest check first;
// checked_at is set by every purchase, webhook update and sync attempt.
const DUE = `s.status='purchased' AND NOT s.test AND s.geliver_shipment_id IS NOT NULL
  AND (s.checked_at IS NULL OR s.checked_at <= now()-make_interval(mins=>$1::int))`;
const CANDIDATES = `SELECT s.id,s.order_id::text,s.geliver_shipment_id,s.checked_at AS previous,s.tracking_status_code
  FROM commerce_geliver_shipments s JOIN commerce_orders o ON o.id=s.order_id
  WHERE ${DUE} AND o.status='shipped' AND s.completed_at > now()-make_interval(days=>${SYNC_MAX_LABEL_AGE_DAYS})
  ORDER BY s.checked_at ASC NULLS FIRST,s.completed_at,s.id LIMIT $2`;

const toCandidate = (row: CandidateRow): GeliverSyncCandidate => ({
  rowId: row.id, orderId: row.order_id, shipmentId: row.geliver_shipment_id, checkedAt: row.previous, trackingStatusCode: row.tracking_status_code,
});

/** Stamps checked_at right before the call; false when a parallel run took the label meanwhile. */
const claim = async (rowId: string, minAgeMinutes: number) =>
  Boolean((await db.query(`UPDATE commerce_geliver_shipments s SET checked_at=now() WHERE s.id=$2 AND ${DUE}`, [minAgeMinutes, rowId])).rowCount);

const describe = (result: GeliverResult<unknown>) =>
  result.kind === "rejected" ? `rejected ${result.code} (HTTP ${result.httpStatus})` : result.kind === "unknown" ? result.reason : "ok";

/** A refused token or IP: every further call would fail the same way. */
const unauthorized = (reply: GeliverResult<unknown>) => reply.kind === "rejected" && (reply.httpStatus === 401 || reply.code === "E1055");

async function syncOne(candidate: GeliverSyncCandidate, reply: GeliverResult<GeliverShipment>): Promise<GeliverSyncResult> {
  if (reply.kind !== "ok") return { ...candidate, outcome: "error", reason: describe(reply).slice(0, 200) };
  const shipment = reply.data;
  if (shipment.id !== candidate.shipmentId) return { ...candidate, outcome: "error", reason: "another shipment in the reply" };
  if (shipment.test) return { ...candidate, outcome: "error", reason: "Geliver reports a test shipment" };
  const event = webhookEventSchema.safeParse({
    event: "TRACK_UPDATED",
    data: { id: candidate.shipmentId, test: false, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl, trackingStatus: shipment.trackingStatus },
  });
  if (!event.success || !event.data.data.trackingStatus) return { ...candidate, outcome: "no_status" };
  const applied = await applyTrackingUpdate(event.data);
  return applied.outcome === "applied"
    ? { ...candidate, outcome: "applied", statusCode: event.data.data.trackingStatus.trackingStatusCode }
    : { ...candidate, outcome: "ignored", reason: applied.reason };
}

/**
 * Fetches up to `limit` live labels of shipped orders not checked for `minAgeMinutes` and applies their tracking status
 * like a webhook. Only with GELIVER_MODE=live. A failed call is logged (ids only) and the run goes on, unless the token
 * or IP is refused or three calls in a row fail; database errors are thrown. `dryRun` lists the labels without calling
 * Geliver or writing.
 */
export async function syncGeliverShipments({ limit = SYNC_DEFAULT_LIMIT, minAgeMinutes = SYNC_DEFAULT_MIN_AGE_MINUTES, dryRun = false, pauseMs = DEFAULT_PAUSE_MS }: {
  limit?: number; minAgeMinutes?: number; dryRun?: boolean; pauseMs?: number;
} = {}): Promise<GeliverSyncSummary> {
  if (geliverMode(process.env) !== "live") return { status: "not_live" };
  const config = geliverConfig();
  if (!config) return { status: "unavailable" };
  if (dryRun) {
    const { rows } = await db.query<CandidateRow>(CANDIDATES, [minAgeMinutes, limit]);
    return { status: "done", dryRun: true, candidates: rows.map(toCandidate) };
  }
  const { rows } = await db.query<CandidateRow>(CANDIDATES, [minAgeMinutes, limit]);
  const results: GeliverSyncResult[] = [];
  let aborted: "unauthorized" | "consecutive_errors" | null = null;
  let errorsInRow = 0;
  for (const candidate of rows.map(toCandidate)) {
    if (!await claim(candidate.rowId, minAgeMinutes)) continue;
    if (results.length && pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
    let reply: GeliverResult<GeliverShipment>;
    try { reply = await getShipment(config, candidate.shipmentId); }
    catch (error) { reply = { kind: "unknown", reason: error instanceof Error ? error.message : "Geliver çağrısı tamamlanamadı.", httpStatus: null }; }
    const result = await syncOne(candidate, reply);
    results.push(result);
    if (result.outcome !== "error") { errorsInRow = 0; continue; }
    console.warn("Geliver sync failed for a shipment", { rowId: result.rowId, orderId: result.orderId, reason: result.reason });
    errorsInRow += 1;
    if (unauthorized(reply)) aborted = "unauthorized";
    else if (errorsInRow >= MAX_CONSECUTIVE_ERRORS) aborted = "consecutive_errors";
    if (aborted) { console.warn("Geliver sync stopped", { reason: aborted, checked: results.length, remaining: rows.length - results.length }); break; }
  }
  const failed = aborted !== null || (results.length > 0 && results.every(r => r.outcome === "error"));
  return { status: "done", dryRun: false, results, aborted, failed };
}
