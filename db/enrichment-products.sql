-- Automatic links must still agree with the current catalog identity. Reviewed manual links remain authoritative.
CREATE OR REPLACE VIEW enrichment_current_sources AS
 SELECT ps.* FROM product_sources ps JOIN products p ON p.id=ps.product_id
 JOIN supplier_items s ON s.id=ps.supplier_item_id
 LEFT JOIN supplier_brands sb ON sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)
 LEFT JOIN brands b ON b.id=sb.brand_id
 WHERE p.merged_into IS NULL AND (ps.method='manual' OR
  (p.brand=COALESCE(b.key,product_brand_key(supplier_item_brand(s.supplier,s.product_data)))
   AND p.part_number=supplier_item_part_number(s.supplier,s.code,s.product_data)));

-- A source observation stays on its original supplier row. Only current, identical master products share it.
CREATE OR REPLACE VIEW enrichment_valid_data AS
 SELECT e.*,j.status,COALESCE(s.product_data->>'oe','') AS donor_oem,
 -- The reviewed master brand of the source row also identifies its manufacturer (enrichment-contract.ts).
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id
  WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS donor_master_brand
 FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
 JOIN product_enrichment_jobs j USING(supplier_item_id)
 WHERE e.supplier_code=s.code
 AND e.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
 AND j.status IN ('complete','partial')
 AND (e.match_basis->>'type' IN ('exact_part','cross_reference') OR
   (e.match_basis->>'type'='oem_reference' AND e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe','')))
-- A hidden supplier OEM (commerce_item_overrides.hide_oem) also stops data matched through it (#865); the raw
-- rows stay so unhiding brings them back. Written as NOT (... AND IN (SELECT ...)): one hashed SubPlan over the small
-- override table, costed as such. A correlated EXISTS is costed as a rescan per row (8x this scan's cost locally,
-- growing with the table), and enrichment_product_candidates, which already expects one row here, then nested this
-- view under every source row: a quadratic plan (#929). A left join or anti-join instead pins the join order and
-- turns per-product lookups into full scans. Both ids are primary keys, so NOT IN's NULL caveat does not apply.
AND NOT (e.match_basis->>'type'='oem_reference' AND COALESCE(e.match_basis->>'referenceSource','supplier_oem')='supplier_oem'
  AND e.supplier_item_id IN (SELECT ho.supplier_item_id FROM commerce_item_overrides ho WHERE ho.hide_oem));

-- A flat candidate view lets point lookups and legacy-batch reconciliation restrict the supplier rows first.
CREATE OR REPLACE VIEW enrichment_product_candidates AS
 SELECT ps.product_id,p.brand AS product_brand,p.part_number,p.name AS product_name,
  s.id AS supplier_item_id,s.code AS supplier_code,
  COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS supplier_brand,
  COALESCE(s.product_data->>'oe','') AS oem,
  (ps.method='manual' OR (p.brand=COALESCE(b.key,product_brand_key(supplier_item_brand(s.supplier,s.product_data)))
   AND p.part_number=supplier_item_part_number(s.supplier,s.code,s.product_data))) AS coherent,
  CASE WHEN e.supplier_item_id IS NOT NULL THEN e.status
   WHEN j.supplier_code=s.code AND j.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
    AND j.oem=COALESCE(s.product_data->>'oe','') AND j.status NOT IN ('complete','partial') THEN j.status
   -- A finished job whose data is dropped by a hidden OEM (#865) is not pending again: collectors would loop on it.
   -- IN (SELECT ...) rather than EXISTS for the costing reason given in enrichment_valid_data (#929).
   WHEN j.status IN ('complete','partial') AND j.supplier_code=s.code
    AND j.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
    AND j.oem=COALESCE(s.product_data->>'oe','')
    AND s.id IN (SELECT ho.supplier_item_id FROM commerce_item_overrides ho WHERE ho.hide_oem) THEN 'not_found'
   ELSE 'pending' END AS status,
  CASE WHEN e.status='complete' THEN 0 WHEN e.status='partial' THEN 1
   WHEN j.supplier_code=s.code AND j.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
    AND j.oem=COALESCE(s.product_data->>'oe','') AND j.status IN ('review','not_found','failed','blocked') THEN 2
   -- The hidden-OEM not_found above (#865) ranks after pending: its data is unusable, so a pending sibling of the same
   -- product becomes the representative and is collected; alone, the product shows not_found and is not collected.
   WHEN j.status IN ('complete','partial') AND j.supplier_code=s.code
    AND j.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
    AND j.oem=COALESCE(s.product_data->>'oe','')
    AND s.id IN (SELECT ho.supplier_item_id FROM commerce_item_overrides ho WHERE ho.hide_oem) THEN 4
   ELSE 3 END AS priority,
  s.presence='present' AS present,COALESCE(j.attempts,0) AS attempts,j.last_error,COALESCE(j.updated_at,p.updated_at) AS updated_at,
  e.imported_at,e.source_url,e.manufacturer,e.manufacturer_part_number,e.image_id,e.payload,e.match_basis
 FROM product_sources ps JOIN products p ON p.id=ps.product_id AND p.merged_into IS NULL
 JOIN supplier_items s ON s.id=ps.supplier_item_id
 LEFT JOIN supplier_brands sb ON sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)
 LEFT JOIN brands b ON b.id=sb.brand_id
 LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
 LEFT JOIN enrichment_valid_data e ON e.supplier_item_id=s.id;

-- Every unmerged master product is counted, even if its source identity needs review.
CREATE OR REPLACE VIEW enrichment_product_catalog AS
 SELECT p.id AS product_id,p.brand AS product_brand,p.part_number,p.name AS product_name,
 r.supplier_item_id,r.supplier_code,r.supplier_brand,r.oem,CASE WHEN r.coherent THEN r.status ELSE 'review' END AS status,
 COALESCE(r.attempts,0) AS attempts,r.last_error,COALESCE(r.updated_at,p.updated_at) AS updated_at,
 CASE WHEN r.coherent THEN r.imported_at END AS imported_at,CASE WHEN r.coherent THEN r.source_url END AS source_url,
 CASE WHEN r.coherent THEN r.manufacturer END AS manufacturer,CASE WHEN r.coherent THEN r.manufacturer_part_number END AS manufacturer_part_number,
 CASE WHEN r.coherent THEN r.image_id END AS image_id,
 CASE WHEN r.coherent THEN r.payload END AS payload,CASE WHEN r.coherent THEN r.match_basis END AS match_basis
 FROM products p LEFT JOIN (
  SELECT DISTINCT ON (product_id) * FROM enrichment_product_candidates
  ORDER BY product_id,coherent DESC,priority,present DESC,oem<>'' DESC,supplier_item_id=product_id DESC,supplier_item_id
 ) r ON r.product_id=p.id WHERE p.merged_into IS NULL;

-- The requested offer keeps its own identity; validation and fitments use the original donor's identity.
-- also mirrored in src/modules/admin/fitment-donor.ts
CREATE OR REPLACE VIEW product_enrichment_shared AS
 SELECT target.id AS supplier_item_id,target.code AS supplier_code,
 COALESCE(NULLIF(target.product_data->>'uk',''),supplier_item_brand(target.supplier,target.product_data),'') AS supplier_brand,
 e.source_url,e.source_method,e.manufacturer,e.manufacturer_part_number,e.image_id,e.payload,e.imported_at,e.match_basis,
 e.supplier_item_id AS donor_item_id,e.supplier_code AS donor_code,e.supplier_brand AS donor_brand,e.donor_oem,e.status,e.donor_master_brand
 FROM (
  SELECT DISTINCT ON (donor.product_id) donor.product_id,e.*
  FROM enrichment_valid_data e JOIN enrichment_current_sources donor ON donor.supplier_item_id=e.supplier_item_id
  ORDER BY donor.product_id,e.status='complete' DESC,e.imported_at DESC,e.supplier_item_id
 ) e
 JOIN products p ON p.id=e.product_id AND p.merged_into IS NULL
 JOIN enrichment_current_sources ps ON ps.product_id=e.product_id
 JOIN supplier_items target ON target.id=ps.supplier_item_id
 UNION ALL
 SELECT e.supplier_item_id,e.supplier_code,e.supplier_brand,e.source_url,e.source_method,e.manufacturer,
 e.manufacturer_part_number,e.image_id,e.payload,e.imported_at,e.match_basis,e.supplier_item_id,e.supplier_code,e.supplier_brand,e.donor_oem,e.status,e.donor_master_brand
 FROM enrichment_valid_data e WHERE NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=e.supplier_item_id);

-- Added only when missing: ADD COLUMN IF NOT EXISTS locks the table (ACCESS EXCLUSIVE) until setup commits even as a no-op.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='enrichment_run_items'::regclass AND attname='product_id' AND NOT attisdropped) THEN
  ALTER TABLE enrichment_run_items ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE SET NULL;
 END IF;
END $$;
-- Replaced only when the validated constraint's quoted values differ from this list: DROP + ADD locks the table
-- (ACCESS EXCLUSIVE, re-validating every row) until setup commits. The guard's ARRAY must match the CHECK exactly, so
-- any change to the list (add, remove, rename, reorder) edits both. Inline, not a helper: tests load single files.
DO $$ BEGIN
 IF ARRAY(SELECT r.m[1] FROM pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid),'''([^'']*)''','g') WITH ORDINALITY r(m,i)
   WHERE k.conrelid='enrichment_run_items'::regclass AND k.conname='enrichment_run_items_status_check' AND k.convalidated ORDER BY r.i)
  IS DISTINCT FROM ARRAY['queued','collecting','complete','partial','review','not_found','failed','blocked','skipped'] THEN
  ALTER TABLE enrichment_run_items DROP CONSTRAINT IF EXISTS enrichment_run_items_status_check;
  ALTER TABLE enrichment_run_items ADD CONSTRAINT enrichment_run_items_status_check CHECK(status IN ('queued','collecting','complete','partial','review','not_found','failed','blocked','skipped'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS enrichment_run_items_product_idx ON enrichment_run_items(product_id,finished_at);
