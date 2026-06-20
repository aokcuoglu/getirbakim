-- v0 schema cleanup: drop OEM child tables, redefine products_oems (v0_product-based),
-- add dnmk_products.oem_no (comma-separated from ptdrk bridge),
-- add v0.products.brand_list_id (FK to brand_list).

-- ==========================================
-- 1. Drop OEM child tables
-- ==========================================
DROP TABLE IF EXISTS v0.dnmk_product_oems CASCADE;
DROP TABLE IF EXISTS v0.bsbg_products_oem_no CASCADE;

-- ==========================================
-- 2. Add dnmk_products.oem_no (comma-separated OEM tokens from ptdrk bridge)
-- ==========================================
ALTER TABLE v0.dnmk_products ADD COLUMN IF NOT EXISTS oem_no TEXT;

-- ==========================================
-- 3. Add v0.products.brand_list_id (FK to brand_list)
-- ==========================================
ALTER TABLE v0.products ADD COLUMN IF NOT EXISTS brand_list_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'products_brand_list_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'brand_list') THEN
        ALTER TABLE v0.products
            ADD CONSTRAINT products_brand_list_id_fkey
            FOREIGN KEY (brand_list_id) REFERENCES v0.brand_list(id) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_v0_products_brand_list ON v0.products (brand_list_id);

-- ==========================================
-- 4. Redefine products_oems: drop old supplier-pair table, create v0_product-based table
--    Old columns: dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no,
--                 brand_list_id, relation_type, created_by
--    New columns: v0_product_id, oem_no, source
-- ==========================================
DROP TABLE IF EXISTS v0.products_oems CASCADE;

CREATE TABLE v0.products_oems (
    id            BIGSERIAL    PRIMARY KEY,
    v0_product_id BIGINT       NOT NULL,
    oem_no        TEXT         NOT NULL,
    source        TEXT         NOT NULL DEFAULT 'MANUAL',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT products_oems_v0_product_id_fkey
        FOREIGN KEY (v0_product_id) REFERENCES v0.products(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_products_oems_v0_product_oem
    ON v0.products_oems (v0_product_id, oem_no);
CREATE INDEX idx_products_oems_oem_no
    ON v0.products_oems (oem_no);
CREATE INDEX idx_products_oems_v0_product
    ON v0.products_oems (v0_product_id);