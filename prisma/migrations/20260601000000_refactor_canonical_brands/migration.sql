/*
  Migration: Refactor dnmk_ptdrk_brands into a canonical brand table with mappings.

  Goal:
  - dnmk_ptdrk_brands becomes the single source of truth for normalized brand names + logos.
  - dnmk_ptdrk_brand_mappings stores the many-to-many relationships between
    canonical brands and source brands (dnmk_brands / ptdrk_brands).

  Steps:
  10. Add logo_url to dnmk_ptdrk_brands (it was dropped by previous migration)
  1. Create dnmk_ptdrk_brand_mappings
  2. Migrate existing dnmk_ptdrk_brands rows into mappings
  3. Backfill logo_url from dnmk_brands into dnmk_ptdrk_brands
  4. Remove dnmk_brands_id / ptdrk_brands_id / mapping_status / match_method from dnmk_ptdrk_brands
  5. Ensure unique normalized_brand
*/

-- 0. Add logo_url column first (may have been dropped by prior migration)
ALTER TABLE v0.dnmk_ptdrk_brands ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 1. Create the new mappings table
CREATE TABLE IF NOT EXISTS v0.dnmk_ptdrk_brand_mappings (
    id SERIAL PRIMARY KEY,
    dnmk_ptdrk_brands_id INT NOT NULL,
    dnmk_brands_id BIGINT,
    ptdrk_brands_id INT,
    mapping_status TEXT DEFAULT 'PENDING',
    match_method TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_dpbrm_dpbrands FOREIGN KEY (dnmk_ptdrk_brands_id)
        REFERENCES v0.dnmk_ptdrk_brands(id) ON DELETE CASCADE
);

CREATE INDEX idx_dpbrm_dpbrands ON v0.dnmk_ptdrk_brand_mappings(dnmk_ptdrk_brands_id);
CREATE INDEX idx_dpbrm_dnmk ON v0.dnmk_ptdrk_brand_mappings(dnmk_brands_id);
CREATE INDEX idx_dpbrm_ptdrk ON v0.dnmk_ptdrk_brand_mappings(ptdrk_brands_id);
CREATE INDEX idx_dpbrm_status ON v0.dnmk_ptdrk_brand_mappings(mapping_status);

-- 2. Migrate existing rows: each current dnmk_ptdrk_brands row becomes a mapping,
--    and we keep the row itself as the canonical brand.
INSERT INTO v0.dnmk_ptdrk_brand_mappings (
    dnmk_ptdrk_brands_id,
    dnmk_brands_id,
    ptdrk_brands_id,
    mapping_status,
    match_method
)
SELECT
    id,
    dnmk_brands_id,
    ptdrk_brands_id,
    mapping_status,
    match_method
FROM v0.dnmk_ptdrk_brands
WHERE dnmk_brands_id IS NOT NULL OR ptdrk_brands_id IS NOT NULL;

-- 3. Update canonical brand logo_url: prefer the logo from the mapping
--    that points to the dnmk_brands row which has the highest product count.
--    We do this per normalized_brand to handle duplicates.
WITH best_mapping AS (
    SELECT DISTINCT ON (mb.normalized_brand)
        mb.id AS canonical_id,
        db.logo_url
    FROM v0.dnmk_ptdrk_brands mb
    INNER JOIN v0.dnmk_ptdrk_brand_mappings m ON m.dnmk_ptdrk_brands_id = mb.id
    LEFT JOIN v0.dnmk_brands db ON db.id = m.dnmk_brands_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c FROM v0.dnmk_products dp WHERE dp.dnmk_brands_id = m.dnmk_brands_id
    ) dpc ON true
    WHERE m.dnmk_brands_id IS NOT NULL
    ORDER BY mb.normalized_brand, dpc.c DESC NULLS LAST, m.id ASC
)
UPDATE v0.dnmk_ptdrk_brands cb
SET logo_url = bm.logo_url
FROM best_mapping bm
WHERE cb.id = bm.canonical_id;

-- 4. Deduplicate canonical brands: keep the row with the most products-linked mapping.
--    Identify rows to delete.
WITH ranked AS (
    SELECT
        mb.id,
        mb.normalized_brand,
        ROW_NUMBER() OVER (
            PARTITION BY mb.normalized_brand
            ORDER BY COALESCE(dpc.c, 0) DESC, m.id ASC
        ) AS rnk
    FROM v0.dnmk_ptdrk_brands mb
    LEFT JOIN v0.dnmk_ptdrk_brand_mappings m ON m.dnmk_ptdrk_brands_id = mb.id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c FROM v0.dnmk_products dp WHERE dp.dnmk_brands_id = m.dnmk_brands_id
    ) dpc ON true
),
to_delete AS (
    SELECT id FROM ranked WHERE rnk > 1
)
-- Before deleting, remap mappings that point to deleted canonical brands
UPDATE v0.dnmk_ptdrk_brand_mappings m
SET dnmk_ptdrk_brands_id = keeper.keeper_id
FROM (
    SELECT r.normalized_brand, MIN(r.id) AS keeper_id
    FROM ranked r
    WHERE r.rnk = 1
    GROUP BY r.normalized_brand
) keeper
INNER JOIN to_delete td ON td.id = m.dnmk_ptdrk_brands_id
WHERE m.dnmk_ptdrk_brands_id = td.id;

-- Now delete the duplicate canonical brand rows
DELETE FROM v0.dnmk_ptdrk_brands
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            mb.id,
            ROW_NUMBER() OVER (
                PARTITION BY mb.normalized_brand
                ORDER BY mb.id ASC
            ) AS rnk
        FROM v0.dnmk_ptdrk_brands mb
    ) sub
    WHERE sub.rnk > 1
);

-- 5. Add NOT NULL and UNIQUE constraints on normalized_brand
ALTER TABLE v0.dnmk_ptdrk_brands ALTER COLUMN normalized_brand SET NOT NULL;
ALTER TABLE v0.dnmk_ptdrk_brands ADD CONSTRAINT uq_dpbrands_normalized UNIQUE (normalized_brand);

-- 6. Drop the old columns no longer needed on dnmk_ptdrk_brands
ALTER TABLE v0.dnmk_ptdrk_brands DROP COLUMN IF EXISTS dnmk_brands_id;
ALTER TABLE v0.dnmk_ptdrk_brands DROP COLUMN IF EXISTS ptdrk_brands_id;
ALTER TABLE v0.dnmk_ptdrk_brands DROP COLUMN IF EXISTS mapping_status;
ALTER TABLE v0.dnmk_ptdrk_brands DROP COLUMN IF EXISTS match_method;

-- 7. Clean up: drop the old unique index on dnmk_brands_id+ptdrk_brands_id (already gone via column drops)
--    Drop old indexes referencing dropped columns
DROP INDEX IF EXISTS v0.idx_dbrands_match_ptbrands;
DROP INDEX IF EXISTS v0.idx_dbrands_match_status;
DROP INDEX IF EXISTS v0.idx_dbrands_match_method;

-- 8. Re-create normalized_brand index with new name for consistency
CREATE INDEX idx_dpbrands_normalized_brand ON v0.dnmk_ptdrk_brands(normalized_brand);
DROP INDEX IF EXISTS v0.idx_dbrands_match_normalized_brand;
