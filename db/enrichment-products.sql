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
 SELECT e.*,j.status,COALESCE(s.product_data->>'oe','') AS donor_oem
 FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
 JOIN product_enrichment_jobs j USING(supplier_item_id)
 WHERE e.supplier_code=s.code
 AND e.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
 AND j.status IN ('complete','partial')
 AND (e.match_basis->>'type'='exact_part' OR
   (e.match_basis->>'type'='oem_reference' AND e.match_basis->>'supplierOem'=COALESCE(s.product_data->>'oe','')));

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
    AND j.oem=COALESCE(s.product_data->>'oe','') AND j.status NOT IN ('complete','partial') THEN j.status ELSE 'pending' END AS status,
  CASE WHEN e.status='complete' THEN 0 WHEN e.status='partial' THEN 1
   WHEN j.supplier_code=s.code AND j.supplier_brand=COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')
    AND j.oem=COALESCE(s.product_data->>'oe','') AND j.status IN ('review','not_found','failed','blocked') THEN 2 ELSE 3 END AS priority,
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
CREATE OR REPLACE VIEW product_enrichment_shared AS
 SELECT target.id AS supplier_item_id,target.code AS supplier_code,
 COALESCE(NULLIF(target.product_data->>'uk',''),supplier_item_brand(target.supplier,target.product_data),'') AS supplier_brand,
 e.source_url,e.source_method,e.manufacturer,e.manufacturer_part_number,e.image_id,e.payload,e.imported_at,e.match_basis,
 e.supplier_item_id AS donor_item_id,e.supplier_code AS donor_code,e.supplier_brand AS donor_brand,e.donor_oem,e.status
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
 e.manufacturer_part_number,e.image_id,e.payload,e.imported_at,e.match_basis,e.supplier_item_id,e.supplier_code,e.supplier_brand,e.donor_oem,e.status
 FROM enrichment_valid_data e WHERE NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=e.supplier_item_id);

ALTER TABLE enrichment_run_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE enrichment_run_items DROP CONSTRAINT IF EXISTS enrichment_run_items_status_check;
ALTER TABLE enrichment_run_items ADD CONSTRAINT enrichment_run_items_status_check
 CHECK(status IN ('queued','collecting','complete','partial','review','not_found','failed','blocked','skipped'));
CREATE INDEX IF NOT EXISTS enrichment_run_items_product_idx ON enrichment_run_items(product_id,finished_at);
