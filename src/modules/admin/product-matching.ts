import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";

export type MatchingParams = { tab?: string; strength?: string; scope?: string; supplier?: string; q?: string; page?: string; decided?: string; refreshed?: string; error?: string };
export type MatchStats = { items: number; groups: number; cross_supplier_groups: number; duplicate_groups: number; grouped_items: number; pair_suggestions: number; references: number; referenced_items: number };
export type PairSuggestion = { brand_a: string; brand_b: string; shared_parts: number; avg_name_similarity: number | null; samples: { part: string; a: string | null; b: string | null }[] };
export type GroupMember = {
  brand: string; part_number: string; supplier_item_id: string; supplier: string; code: string; name: string | null;
  source_brand: string | null; cost: string | null; currency: string | null; in_stock: boolean | null; sale_price_kurus: number | null;
};
export type MatchGroup = { brand: string; part_number: string; members: number; suppliers: string[]; items: GroupMember[] };

// Name similarity of real alias/rebrand pairs measured 0.15–0.37, coincidental number collisions ~0.02–0.05.
export const strongSimilarity = 0.1;
const pageSize = 25;
const pageOf = (value: string | undefined, pages: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(pages, Math.max(1, parsed)) : 1;
};

export async function productMatchingData(params: MatchingParams) {
  await requireAdmin();
  const [run, bySupplier, decisions, strength] = await Promise.all([
    db.query<{ completed_at: Date; started_at: Date; stats: MatchStats }>("SELECT * FROM product_match_runs ORDER BY id DESC LIMIT 1"),
    db.query<{ supplier: string; items: number; grouped: number; cross: number }>(`SELECT i.supplier,count(*)::int AS items,
      count(g.brand)::int AS grouped,count(g.brand) FILTER (WHERE cardinality(g.suppliers)>1)::int AS cross
      FROM product_match_items i LEFT JOIN product_match_groups g USING(brand,part_number) GROUP BY 1 ORDER BY 1`),
    db.query<{ status: string; count: number }>("SELECT status,count(*)::int FROM product_brand_pair_decisions GROUP BY 1"),
    db.query<{ strong: number; weak: number }>(`SELECT count(*) FILTER (WHERE avg_name_similarity>=$1)::int AS strong,
      count(*) FILTER (WHERE avg_name_similarity IS NULL OR avg_name_similarity<$1)::int AS weak FROM product_brand_pair_suggestions`, [strongSimilarity]),
  ]);
  const tab = params.tab === "groups" ? "groups" : "pairs";
  const base = { run: run.rows[0] ?? null, bySupplier: bySupplier.rows, decisions: Object.fromEntries(decisions.rows.map(row => [row.status, row.count])) as Record<string, number>,
    strength: strength.rows[0], tab };
  if (tab === "pairs") {
    const weak = params.strength === "weak";
    const filter = weak ? "avg_name_similarity IS NULL OR avg_name_similarity<$1" : "avg_name_similarity>=$1";
    const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM product_brand_pair_suggestions WHERE ${filter}`, [strongSimilarity])).rows[0].count;
    const pages = Math.max(1, Math.ceil(total / pageSize)), page = pageOf(params.page, pages);
    const pairs = (await db.query<PairSuggestion>(`SELECT * FROM product_brand_pair_suggestions WHERE ${filter}
      ORDER BY shared_parts DESC,brand_a,brand_b LIMIT ${pageSize} OFFSET $2`, [strongSimilarity, (page - 1) * pageSize])).rows;
    return { ...base, pairs, groups: [] as MatchGroup[], total, page, pages, weak };
  }
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (params.scope === "duplicate") conditions.push("cardinality(g.suppliers)=1");
  else if (params.scope !== "all") conditions.push("cardinality(g.suppliers)>1");
  if (params.supplier && ["basbug", "dinamik", "seta"].includes(params.supplier)) { values.push(params.supplier); conditions.push(`$${values.length}=ANY(g.suppliers)`); }
  const q = params.q?.trim().toUpperCase().slice(0, 80);
  if (q) {
    values.push(q.replace(/[^A-Z0-9]/g, ""), q.replace(/[^A-Z0-9]/g, ""));
    conditions.push(`(g.part_number LIKE $${values.length - 1}||'%' OR g.brand=$${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM product_match_groups g ${where}`, values)).rows[0].count;
  const pages = Math.max(1, Math.ceil(total / pageSize)), page = pageOf(params.page, pages);
  const groups = (await db.query<Omit<MatchGroup, "items">>(`SELECT g.* FROM product_match_groups g ${where}
    ORDER BY cardinality(g.suppliers) DESC,g.members DESC,g.brand,g.part_number LIMIT ${pageSize} OFFSET $${values.length + 1}`, [...values, (page - 1) * pageSize])).rows;
  // Source cost as the supplier states it; Dinamik's price meaning is not verified yet, so nothing is converted.
  const members = groups.length ? (await db.query<GroupMember>(`SELECT m.brand,m.part_number,m.supplier_item_id,m.supplier,i.code,m.name,
      supplier_item_brand(i.supplier,i.product_data) AS source_brand,
      CASE i.supplier WHEN 'dinamik' THEN i.price_data->>'fiyat' ELSE i.price_data->>'nf' END AS cost,
      CASE i.supplier WHEN 'dinamik' THEN NULL ELSE i.product_data->>'dc' END AS currency,
      CASE i.supplier WHEN 'dinamik' THEN (i.stock_data->>'varyokAll')='VAR' ELSE (i.stock_data->>'stok')::numeric>0 END AS in_stock,
      sale.price_kurus AS sale_price_kurus
    FROM product_match_items m JOIN supplier_items i ON i.id=m.supplier_item_id
    LEFT JOIN LATERAL (SELECT price_kurus FROM commerce_catalog c WHERE c.id=i.id AND i.supplier<>'dinamik' OFFSET 0) sale ON true
    WHERE (m.brand,m.part_number) IN (SELECT * FROM unnest($1::text[],$2::text[]))
    ORDER BY m.supplier,i.code`, [groups.map(g => g.brand), groups.map(g => g.part_number)])).rows : [];
  return { ...base, pairs: [] as PairSuggestion[], total, page, pages, weak: false,
    groups: groups.map(group => ({ ...group, items: members.filter(m => m.brand === group.brand && m.part_number === group.part_number) })) };
}
