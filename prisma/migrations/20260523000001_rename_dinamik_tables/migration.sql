-- Rename parcatedarik tables for brevity
-- dinamik_brands                 → dbrands
-- dinamik_parca_brand_aliases    → dbrands_match
-- dinamik_parcatedarik_model_matches → dpmatch
-- dinamik_products               → dproducts

ALTER TABLE IF EXISTS parcatedarik.dinamik_brands RENAME TO dbrands;
ALTER TABLE IF EXISTS parcatedarik.dinamik_parca_brand_aliases RENAME TO dbrands_match;
ALTER TABLE IF EXISTS parcatedarik.dinamik_parcatedarik_model_matches RENAME TO dpmatch;
ALTER TABLE IF EXISTS parcatedarik.dinamik_products RENAME TO dproducts;
