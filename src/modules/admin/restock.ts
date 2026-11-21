import "server-only";
// Callers check the admin session (page, actions, adminNavCounts); kept free of it so tests can run the queries.
import { db } from "@/lib/db";
import { catalogRowsByIdsSql } from "@/modules/store/catalog";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";

/**
 * A "Gelince haber ver" request (#475) with the cheapest offer that can be ordered now, if any. The offer's columns
 * come together: the query only picks a priced offer, so a row with offer_id always has its price.
 */
type RestockRequestRow = {
  id: string; email: string; supplier: string; code: string; brand: string; name: string; status: "pending" | "notified";
  requested_at: Date; notified_at: Date | null; supplier_item_id: string | null;
} & (
  | { offer_id: string; offer_price_kurus: number; offer_stock_label: string | null }
  | { offer_id: null; offer_price_kurus: null; offer_stock_label: null }
);
export type RestockTab = "pending" | "notified";
export const restockListLimit = 500;

// Purchasable again: a row of the request's product group or with its supplier + code, priced and orderable in the
// shared commerce view (what cart and checkout accept). The open requests' candidate ids are collected first and priced
// in one id-array read (catalogRowsByIdsSql): a per-request LATERAL repeats the view's import step per row (#1168).
// `pendingSql` picks the requests to price; the notified tab prices none.
const offerCte = (pendingSql = "r.status='pending'") => `WITH open AS MATERIALIZED (
  SELECT r.id,r.supplier,r.code,COALESCE(p.merged_into,p.id) AS product_id FROM restock_requests r LEFT JOIN products p ON p.id=r.product_id WHERE ${pendingSql}),
 candidate AS MATERIALIZED (
  SELECT o.id AS request_id,m.supplier_item_id AS id FROM open o JOIN product_sources m ON m.product_id=o.product_id
  UNION SELECT o.id,i.id FROM open o JOIN supplier_items i ON i.supplier=o.supplier AND i.code=o.code AND i.presence='present'
   -- The saleable predicate of supplier_items_saleable_code_idx (= commerce_supplier_items), so the partial index applies.
   AND ((i.supplier='basbug' AND i.warehouse='MRK') OR i.supplier IN ('seta','manual') OR (i.supplier='dinamik' AND i.stock_data IS NOT NULL)) AND NOT i.conflicting),
 priced AS MATERIALIZED (${catalogRowsByIdsSql("ARRAY(SELECT id FROM candidate)")}),
 offer AS (SELECT DISTINCT ON (k.request_id) k.request_id,c.id::text,c.price_kurus,c.stock_label FROM candidate k JOIN priced c ON c.id=k.id
  WHERE c.available AND c.price_kurus IS NOT NULL AND c.company=ANY($1::text[]) ORDER BY k.request_id,c.price_kurus,c.id)`;
const offerJoin = "LEFT JOIN offer ON offer.request_id=r.id";

/** Requests of one tab; open ones whose product can be ordered again ("Bildirilecek") first. */
export async function loadRestockRequests(tab: RestockTab) {
  const [rows, counts] = await Promise.all([
    db.query<RestockRequestRow>(`${offerCte("r.status='pending' AND $2='pending'")}
     SELECT r.id,r.email,r.supplier,r.code,r.brand,r.name,r.status,r.requested_at,r.notified_at,r.supplier_item_id::text,
      offer.id AS offer_id,offer.price_kurus AS offer_price_kurus,offer.stock_label AS offer_stock_label
     FROM restock_requests r ${offerJoin} WHERE r.status=$2
     ORDER BY offer.request_id IS NULL,${tab === "notified" ? "r.notified_at DESC" : "r.requested_at"},r.id LIMIT ${restockListLimit + 1}`, [storefrontCompanies(), tab]),
    db.query<{ pending: number; notified: number }>(`SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='notified')::int AS notified FROM restock_requests`),
  ]);
  return { rows: rows.rows.slice(0, restockListLimit), more: rows.rows.length > restockListLimit, counts: counts.rows[0] };
}

/** Open requests whose product can be ordered again: the navigation badge. */
export async function restockDueCount() {
  return (await db.query<{ count: number }>(`${offerCte()} SELECT count(*)::int AS count FROM offer`, [storefrontCompanies()])).rows[0].count;
}

/** Marks open requests notified (the admin sent the notice by hand); returns how many changed. */
export async function markRestockNotified(ids: string[], adminId: string) {
  return (await db.query(`UPDATE restock_requests SET status='notified',notified_at=now(),notified_by=$2
   WHERE id=ANY($1::uuid[]) AND status='pending'`, [ids, adminId])).rowCount ?? 0;
}

/** Deletes a request at the shopper's wish (withdrawal, KVKK). */
export async function deleteRestockRequest(id: string) {
  return (await db.query("DELETE FROM restock_requests WHERE id=$1", [id])).rowCount ?? 0;
}
