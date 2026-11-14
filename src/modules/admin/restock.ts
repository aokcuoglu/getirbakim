import "server-only";
// Callers check the admin session (page, actions, adminNavCounts); kept free of it so tests can run the queries.
import { db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";

/** A "Gelince haber ver" request (#475) with the cheapest offer that can be ordered now, if any. */
export type RestockRequestRow = {
  id: string; email: string; supplier: string; code: string; brand: string; name: string; status: "pending" | "notified";
  requested_at: Date; notified_at: Date | null; supplier_item_id: string | null;
  offer_id: string | null; offer_price_kurus: number | null; offer_stock_label: string | null;
};
export type RestockTab = "pending" | "notified";
export const restockListLimit = 500;

// Purchasable again: a row of the request's product group or with its supplier + code, priced and orderable in the
// shared commerce view (what cart and checkout accept). Read per request by primary key (LATERAL ... OFFSET 0).
const offerSql = `LEFT JOIN products p ON p.id=r.product_id
 LEFT JOIN LATERAL (
  SELECT c.id::text,c.price_kurus,c.stock_label FROM (
   SELECT m.supplier_item_id AS id FROM product_sources m WHERE m.product_id=COALESCE(p.merged_into,p.id)
   UNION SELECT i.id FROM supplier_items i WHERE i.supplier=r.supplier AND i.code=r.code AND i.presence='present') candidate
  JOIN LATERAL (SELECT * FROM commerce_catalog cc WHERE cc.id=candidate.id OFFSET 0) c ON true
  WHERE c.available AND c.price_kurus IS NOT NULL AND c.company=ANY($1::text[])
  ORDER BY c.price_kurus,c.id LIMIT 1) offer ON r.status='pending'`;

/** Requests of one tab; open ones whose product can be ordered again ("Bildirilecek") first. */
export async function loadRestockRequests(tab: RestockTab) {
  const [rows, counts] = await Promise.all([
    db.query<RestockRequestRow>(`SELECT r.id,r.email,r.supplier,r.code,r.brand,r.name,r.status,r.requested_at,r.notified_at,r.supplier_item_id::text,
      offer.id AS offer_id,offer.price_kurus AS offer_price_kurus,offer.stock_label AS offer_stock_label
     FROM restock_requests r ${offerSql} WHERE r.status=$2
     ORDER BY offer.id IS NULL,${tab === "notified" ? "r.notified_at DESC" : "r.requested_at"},r.id LIMIT ${restockListLimit + 1}`, [storefrontCompanies(), tab]),
    db.query<{ pending: number; notified: number }>(`SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='notified')::int AS notified FROM restock_requests`),
  ]);
  return { rows: rows.rows.slice(0, restockListLimit), more: rows.rows.length > restockListLimit, counts: counts.rows[0] };
}

/** Open requests whose product can be ordered again: the navigation badge. */
export async function restockDueCount() {
  return (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM restock_requests r ${offerSql}
   WHERE r.status='pending' AND offer.id IS NOT NULL`, [storefrontCompanies()])).rows[0].count;
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
