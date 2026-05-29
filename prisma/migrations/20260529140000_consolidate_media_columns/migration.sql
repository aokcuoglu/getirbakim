-- Consolidate logo/image columns:
--   Move logo_url from ptdrk_brands + dnmk_ptdrk_brands → dnmk_brands
--   Move image_url from ptdrk_products → dnmk_products
--   After matching in Admin Panel, media is stored on dnmk tables only

-- 1. Add logo_url to dnmk_brands
ALTER TABLE v0.dnmk_brands ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Copy APPROVED logo URLs from match table into dnmk_brands
UPDATE v0.dnmk_brands db
SET logo_url = mb.logo_url
FROM v0.dnmk_ptdrk_brands mb
WHERE db.id = mb.dnmk_brands_id
  AND db.logo_url IS NULL
  AND mb.logo_url IS NOT NULL
  AND mb.mapping_status = 'APPROVED';

-- 3. Drop logo_url from dnmk_ptdrk_brands (consolidated into dnmk_brands)
ALTER TABLE v0.dnmk_ptdrk_brands DROP COLUMN IF EXISTS logo_url;

-- 4. Drop logo_url from ptdrk_brands (consolidated into dnmk_brands)
ALTER TABLE v0.ptdrk_brands DROP COLUMN IF EXISTS logo_url;

-- 5. Drop image_url from ptdrk_products (consolidated into dnmk_products)
ALTER TABLE v0.ptdrk_products DROP COLUMN IF EXISTS image_url;

-- dnmk_products.image_url already exists in the restored DB, no change needed
