import "server-only";
import type { Pool } from "pg";

export const compact = (value: string | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

/**
 * Whether product `p` has a supplier row whose code contains the compact query `n` (punctuation ignored). From three
 * characters on, the trigram index on supplier_item_search_codes (db/search.sql: the same compact code, lowercased, plus
 * the OEM number) narrows supplier_items first and the original condition still decides; scanning every supplier row
 * took ~1 s per query. The index folds Turkish letters (Ç → c) where this condition drops them, so only a query running
 * across such a letter could differ. Shorter queries have no trigram to look up and keep the plain scan.
 */
export const codeMatch = (q: string, n: string) => q.length >= 3
  ? `p.id IN (SELECT s.product_id FROM supplier_items i JOIN product_sources s ON s.supplier_item_id=i.id
      WHERE supplier_item_search_codes(i.code,i.product_data) LIKE '%'||lower(${n})||'%' AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||${n}||'%')`
  : `EXISTS (SELECT 1 FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id
      WHERE s.product_id=p.id AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||${n}||'%')`;

export type EquivalentVia = "code" | "oem" | "reference";
export type EquivalentTarget = {
  id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; same_brand: boolean;
  via: EquivalentVia[]; equivalent: boolean; rejected: boolean;
};

/**
 * Products that could be linked as equivalents of product `id` (#584). A product is found through its part number or a
 * supplier code (the merge search's condition), through an OEM number it shares (exact: supplier OEM numbers of
 * product_references, db/product-matching.sql, which product_references_key_idx reads) or through a hand-entered OEM or
 * competitor number (product_override_references). Shorter queries than three characters find nothing.
 */
export async function searchEquivalentTargets(database: Pick<Pool, "query">, id: string, query: string | undefined) {
  const q = compact(query);
  if (q.length < 3) return { q, targets: [] as EquivalentTarget[] };
  const targets = (await database.query<EquivalentTarget>(`WITH found AS (
      SELECT p.id, 'code' AS via FROM products p WHERE p.part_number LIKE '%'||$2||'%' OR ${codeMatch(q, "$2")}
      UNION ALL
      SELECT s.product_id, 'oem' FROM product_references r JOIN product_sources s ON s.supplier_item_id=r.supplier_item_id
        WHERE r.brand='ORIJINAL' AND r.part_number=$2
      UNION ALL
      SELECT o.product_id, 'reference' FROM product_override_references o
        WHERE o.action='add' AND o.kind IN ('oem','cross') AND o.number_key=$2
    ), hits AS (SELECT id, array_agg(DISTINCT via ORDER BY via) AS via FROM found WHERE id<>$1 GROUP BY id)
    SELECT p.id,p.brand_label,p.code,p.name,p.suppliers,p.brand=self.brand AS same_brand,h.via,
      EXISTS (SELECT 1 FROM product_equivalents e WHERE e.product_id=$1 AND e.equivalent_id=p.id) AS equivalent,
      EXISTS (SELECT 1 FROM product_equivalent_decisions d WHERE d.product_a=least($1::uuid,p.id) AND d.product_b=greatest($1::uuid,p.id)
        AND d.status='unrelated') AS rejected
    FROM hits h JOIN products p ON p.id=h.id AND p.merged_into IS NULL, (SELECT brand FROM products WHERE id=$1) self
    ORDER BY equivalent, p.suppliers='{}', p.brand_label, p.code LIMIT 30`, [id, q])).rows;
  return { q, targets };
}
