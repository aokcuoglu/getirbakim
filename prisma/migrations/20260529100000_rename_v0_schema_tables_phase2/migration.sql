-- Rename v0 schema tables to meaningful names (phase 2)
-- dnbrd -> dnmk_brands (Dinamik brands)
-- dnprd -> dnmk_products (Dinamik products)
-- dnprdh -> dnmk_product_history (Dinamik product price/stock history)
-- dnprdt -> dnmk_product_detail (Dinamik product detail/snapshot)
-- dpbrd -> dnmk_ptdrk_brands (Dinamik-ParcaTedarik brand aliases)
-- dpprd -> dnmk_ptdrk_products (Dinamik-ParcaTedarik product matches)
-- ptbrd -> ptdrk_brands (ParcaTedarik brands)
-- ptprd -> ptdrk_products (ParcaTedarik products)

-- Rename tables
ALTER TABLE v0.dnbrd RENAME TO dnmk_brands;
ALTER TABLE v0.dnprd RENAME TO dnmk_products;
ALTER TABLE v0.dnprdh RENAME TO dnmk_product_history;
ALTER TABLE v0.dnprdt RENAME TO dnmk_product_detail;
ALTER TABLE v0.dpbrd RENAME TO dnmk_ptdrk_brands;
ALTER TABLE v0.dpprd RENAME TO dnmk_ptdrk_products;
ALTER TABLE v0.ptbrd RENAME TO ptdrk_brands;
ALTER TABLE v0.ptprd RENAME TO ptdrk_products;

-- Rename FK columns in dnmk_ptdrk_products (was dpprd)
ALTER TABLE v0.dnmk_ptdrk_products RENAME COLUMN dproducts_id TO dnmk_products_id;
ALTER TABLE v0.dnmk_ptdrk_products RENAME COLUMN ptproducts_id TO ptdrk_products_id;

-- Rename FK columns in dnmk_ptdrk_brands (was dpbrd)
ALTER TABLE v0.dnmk_ptdrk_brands RENAME COLUMN dbrands_id TO dnmk_brands_id;
ALTER TABLE v0.dnmk_ptdrk_brands RENAME COLUMN ptbrands_id TO ptdrk_brands_id;

-- Rename FK columns in ptdrk_products (was ptprd)
ALTER TABLE v0.ptdrk_products RENAME COLUMN ptbrands_id TO ptdrk_brands_id;

-- Rename FK columns in oems
ALTER TABLE v0.oems RENAME COLUMN ptprd_id TO ptdrk_products_id;

-- Rename FK columns in dnmk_products (was dnprd)
ALTER TABLE v0.dnmk_products RENAME COLUMN dbrands_id TO dnmk_brands_id;

-- Rename FK columns in dnmk_product_detail (was dnprdt)
ALTER TABLE v0.dnmk_product_detail RENAME COLUMN dproduct_id TO dnmk_products_id;

-- Rename FK columns in dnmk_product_history (was dnprdh)
ALTER TABLE v0.dnmk_product_history RENAME COLUMN dproduct_id TO dnmk_products_id;
