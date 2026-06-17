-- Faz 0: Add OEM child tables for dnmk and bsbg products
-- Reversible: DROP TABLE ile geri alınabilir.

-- ==========================================
-- v0.dnmk_product_oems
-- ptdrk.ref_no'dan taşınan veya manuel girilen OEM'ler
-- ==========================================
CREATE TABLE IF NOT EXISTS v0.dnmk_product_oems (
  id              SERIAL       PRIMARY KEY,
  dnmk_products_id BIGINT      NOT NULL,
  oem_no          TEXT         NOT NULL,
  source          TEXT         NOT NULL DEFAULT 'PTDRK_BRIDGE',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT dnmk_product_oems_dnmk_products_id_fk
    FOREIGN KEY (dnmk_products_id) REFERENCES v0.dnmk_products(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dnmk_product_oems_product_oem
  ON v0.dnmk_product_oems (dnmk_products_id, oem_no);
CREATE INDEX IF NOT EXISTS idx_dnmk_product_oems_oem_no
  ON v0.dnmk_product_oems (oem_no);
CREATE INDEX IF NOT EXISTS idx_dnmk_product_oems_product
  ON v0.dnmk_product_oems (dnmk_products_id);

-- ==========================================
-- v0.bsbg_products_oem_no
-- Manuel girilen ek OEM'ler (sync'ten gelen ana oem_no bsbg_products.oem_no'da kalır)
-- ==========================================
CREATE TABLE IF NOT EXISTS v0.bsbg_products_oem_no (
  id               SERIAL      PRIMARY KEY,
  bsbg_products_id BIGINT      NOT NULL,
  oem_no           TEXT        NOT NULL,
  source           TEXT        NOT NULL DEFAULT 'MANUAL',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bsbg_products_oem_no_bsbg_products_id_fk
    FOREIGN KEY (bsbg_products_id) REFERENCES v0.bsbg_products(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bsbg_products_oem_no_product_oem
  ON v0.bsbg_products_oem_no (bsbg_products_id, oem_no);
CREATE INDEX IF NOT EXISTS idx_bsbg_products_oem_no_oem_no
  ON v0.bsbg_products_oem_no (oem_no);
CREATE INDEX IF NOT EXISTS idx_bsbg_products_oem_no_product
  ON v0.bsbg_products_oem_no (bsbg_products_id);

-- ==========================================
-- Truncate matching tables (Faz 0 reset)
-- brand_mappings ve brand_list DOKUNULMAZ.
-- ==========================================
DO $$
BEGIN
  -- Sırayla truncate, var olmayan tabloları atla
  BEGIN EXECUTE 'TRUNCATE TABLE v0.product_public_part_links RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN EXECUTE 'TRUNCATE TABLE v0.product_code_signals RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN EXECUTE 'TRUNCATE TABLE v0.product_sources RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN EXECUTE 'TRUNCATE TABLE v0.products RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN EXECUTE 'TRUNCATE TABLE v0.products_oems RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN EXECUTE 'TRUNCATE TABLE v0.product_mapping RESTART IDENTITY CASCADE'; EXCEPTION WHEN undefined_table THEN NULL; END;
END $$;