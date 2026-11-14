// The enrichments an export carries: those imported after $1 (the watermark), plus the supplier items in $2 (a JSON
// array of bundle items, the sync's retry list of enrichments the target skipped), matched by id or by natural key.
// A product whose enrichment the target could not place yet is therefore sent again whatever the watermark says.
const RETRY_ITEMS = "jsonb_to_recordset($2::jsonb) AS r(id uuid, supplier text, company text, list_group text, warehouse text, code text)";
export const EXPORTED_ENRICHMENT_IDS = `SELECT supplier_item_id FROM product_enrichments WHERE imported_at>$1
  UNION SELECT e.supplier_item_id FROM product_enrichments e JOIN ${RETRY_ITEMS} ON r.id=e.supplier_item_id
  UNION SELECT e.supplier_item_id FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
    JOIN ${RETRY_ITEMS} ON (s.supplier,s.company,s.list_group,s.warehouse,s.code)=(r.supplier,r.company,r.list_group,r.warehouse,r.code)`;
