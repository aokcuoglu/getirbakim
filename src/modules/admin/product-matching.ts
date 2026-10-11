import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";

export type MatchingParams = { tab?: string; strength?: string; scope?: string; supplier?: string; q?: string; page?: string; decided?: string; refreshed?: string; error?: string };
// Equivalence keys arrived later; runs recorded before them lack those fields.
export type MatchStats = { items: number; groups: number; cross_supplier_groups: number; duplicate_groups: number; grouped_items: number; pair_suggestions: number; references: number; referenced_items: number;
  oem_references?: number; equivalence_groups?: number; cross_supplier_equivalence_groups?: number; equivalent_items?: number; ean_pair_suggestions?: number };
export type EanSample = { ean: string; part_a: string; a: string | null; part_b: string; b: string | null };
export type PairSuggestion = { brand_a: string; brand_b: string; shared_parts: number; shared_eans: number; avg_name_similarity: number | null;
  samples: { part: string; a: string | null; b: string | null }[]; ean_samples: EanSample[] };
export type GroupMember = {
  brand: string; part_number: string; supplier_item_id: string; supplier: string; code: string; name: string | null;
  source_brand: string | null; cost: string | null; currency: string | null; in_stock: boolean | null; sale_price_kurus: number | null;
};
export type MatchGroup = { brand: string; part_number: string; members: number; suppliers: string[]; items: GroupMember[] };
// `direct`: the item's own brand + part number is the reference; otherwise the item states it (OEM / competitor code).
export type EquivalenceMember = GroupMember & { direct: boolean };
export type EquivalenceGroup = { brand: string; part_number: string; direct: number; referencing: number; products: number; members: number; suppliers: string[]; items: EquivalenceMember[] };

// Name similarity of real alias/rebrand pairs measured 0.15–0.37, coincidental number collisions ~0.02–0.05.
export const strongSimilarity = 0.1;
const pageSize = 25;
const pageOf = (value: string | undefined, pages: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(pages, Math.max(1, parsed)) : 1;
};

// Source cost as the supplier states it; Dinamik's price meaning is not verified yet, so nothing is converted.
const memberColumns = `m.supplier_item_id,m.supplier,i.code,m.name,
  supplier_item_brand(i.supplier,i.product_data) AS source_brand,
  CASE i.supplier WHEN 'dinamik' THEN i.price_data->>'fiyat' ELSE i.price_data->>'nf' END AS cost,
  CASE i.supplier WHEN 'dinamik' THEN NULL ELSE i.product_data->>'dc' END AS currency,
  CASE i.supplier WHEN 'dinamik' THEN (i.stock_data->>'varyokAll')='VAR' ELSE (i.stock_data->>'stok')::numeric>0 END AS in_stock,
  sale.price_kurus AS sale_price_kurus`;
const saleJoin = "LEFT JOIN LATERAL (SELECT price_kurus FROM commerce_catalog c WHERE c.id=i.id AND i.supplier<>'dinamik' OFFSET 0) sale ON true";

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
  const tab = params.tab === "groups" || params.tab === "equivalents" ? params.tab : "pairs";
  const base = { run: run.rows[0] ?? null, bySupplier: bySupplier.rows, decisions: Object.fromEntries(decisions.rows.map(row => [row.status, row.count])) as Record<string, number>,
    strength: strength.rows[0], tab };
  if (tab === "pairs") {
    const weak = params.strength === "weak";
    const filter = weak ? "avg_name_similarity IS NULL OR avg_name_similarity<$1" : "avg_name_similarity>=$1";
    const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM product_brand_pair_suggestions WHERE ${filter}`, [strongSimilarity])).rows[0].count;
    const pages = Math.max(1, Math.ceil(total / pageSize)), page = pageOf(params.page, pages);
    const pairs = (await db.query<PairSuggestion>(`SELECT * FROM product_brand_pair_suggestions WHERE ${filter}
      ORDER BY greatest(shared_parts,shared_eans) DESC,brand_a,brand_b LIMIT ${pageSize} OFFSET $2`, [strongSimilarity, (page - 1) * pageSize])).rows;
    return { ...base, pairs, groups: [] as MatchGroup[], equivalents: [] as EquivalenceGroup[], total, page, pages, weak };
  }
  if (tab === "equivalents") return { ...base, ...await equivalenceData(params), pairs: [] as PairSuggestion[], groups: [] as MatchGroup[], weak: false };
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
  const members = groups.length ? (await db.query<GroupMember>(`SELECT m.brand,m.part_number,${memberColumns}
    FROM product_match_items m JOIN supplier_items i ON i.id=m.supplier_item_id ${saleJoin}
    WHERE (m.brand,m.part_number) IN (SELECT * FROM unnest($1::text[],$2::text[]))
    ORDER BY m.supplier,i.code`, [groups.map(g => g.brand), groups.map(g => g.part_number)])).rows : [];
  return { ...base, pairs: [] as PairSuggestion[], equivalents: [] as EquivalenceGroup[], total, page, pages, weak: false,
    groups: groups.map(group => ({ ...group, items: members.filter(m => m.brand === group.brand && m.part_number === group.part_number) })) };
}

async function equivalenceData(params: MatchingParams) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (params.scope === "single") conditions.push("cardinality(g.suppliers)=1");
  else if (params.scope !== "all") conditions.push("cardinality(g.suppliers)>1");
  if (params.supplier && ["basbug", "dinamik", "seta"].includes(params.supplier)) { values.push(params.supplier); conditions.push(`$${values.length}=ANY(g.suppliers)`); }
  const q = params.q?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 80);
  if (q) { values.push(q); conditions.push(`(g.part_number LIKE $${values.length}||'%' OR g.brand=$${values.length})`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM product_equivalence_groups g ${where}`, values)).rows[0].count;
  const pages = Math.max(1, Math.ceil(total / pageSize)), page = pageOf(params.page, pages);
  const groups = (await db.query<Omit<EquivalenceGroup, "items">>(`SELECT g.* FROM product_equivalence_groups g ${where}
    ORDER BY cardinality(g.suppliers) DESC,g.products DESC,g.brand,g.part_number LIMIT ${pageSize} OFFSET $${values.length + 1}`, [...values, (page - 1) * pageSize])).rows;
  const keys = [groups.map(g => g.brand), groups.map(g => g.part_number)];
  const members = groups.length ? (await db.query<EquivalenceMember>(`WITH keys AS (SELECT * FROM unnest($1::text[],$2::text[]) k(brand,part_number)),
    links AS (SELECT DISTINCT ON (ref_brand,ref_part,supplier_item_id) * FROM (
      SELECT k.brand AS ref_brand,k.part_number AS ref_part,m.supplier_item_id,true AS direct FROM keys k JOIN product_match_items m USING(brand,part_number)
      UNION ALL SELECT k.brand,k.part_number,r.supplier_item_id,false FROM keys k JOIN product_references r USING(brand,part_number)
    ) l ORDER BY ref_brand,ref_part,supplier_item_id,direct DESC)
    SELECT l.ref_brand AS brand,l.ref_part AS part_number,l.direct,${memberColumns}
    FROM links l JOIN product_match_items m ON m.supplier_item_id=l.supplier_item_id JOIN supplier_items i ON i.id=m.supplier_item_id ${saleJoin}
    ORDER BY l.direct DESC,m.supplier,i.code`, keys)).rows : [];
  return { total, page, pages, equivalents: groups.map(group => ({ ...group, items: members.filter(m => m.brand === group.brand && m.part_number === group.part_number) })) };
}
