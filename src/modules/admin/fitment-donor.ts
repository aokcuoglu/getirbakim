// The enrichment a supplier item reads (its own or a donor offer's on the same master product), for one item:
// `(payload, donor_item_id)`, bound to the outer query's `j.supplier_item_id`. Use as `LEFT JOIN LATERAL (…) e ON true`.
// - The order matches product_enrichment_shared (db/enrichment-products.sql) and product_enrichment_shared_compute
//   (db/enrichment-shared-links.sql). Its last key, supplier_item_id, makes the order total, so LIMIT 1 = DISTINCT ON.
// - The OFFSET 0 fences keep the lookups per offer; without them the plan falls back to a full scan (450–1,600 ms).
// - merged_into and the identity rules live in enrichment_current_sources.
export const fitmentDonorLateral = `SELECT picked.payload, picked.donor_item_id
  FROM enrichment_current_sources target
  CROSS JOIN LATERAL (
    SELECT e.payload, e.supplier_item_id AS donor_item_id
    FROM product_sources link
    CROSS JOIN LATERAL (SELECT 1 FROM enrichment_current_sources donor WHERE donor.supplier_item_id=link.supplier_item_id OFFSET 0) donor
    CROSS JOIN LATERAL (SELECT v.* FROM enrichment_valid_data v WHERE v.supplier_item_id=link.supplier_item_id OFFSET 0) e
    WHERE link.product_id=target.product_id
    ORDER BY e.status='complete' DESC, e.imported_at DESC, e.supplier_item_id LIMIT 1
  ) picked
  WHERE target.supplier_item_id=j.supplier_item_id
  UNION ALL
  SELECT e.payload, e.supplier_item_id FROM enrichment_valid_data e
  WHERE e.supplier_item_id=j.supplier_item_id
    AND NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=e.supplier_item_id)`;
