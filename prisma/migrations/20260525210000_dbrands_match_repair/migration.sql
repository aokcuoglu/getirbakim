-- Idempotent repair: align dbrands_match with Prisma (dbrands_id → dbrands.id, normalized column).
-- Safe if 20260525140000 already ran; fixes DBs stuck on legacy column names or partial FK migration.

-- 1) Legacy column renames (dinamik_brand / parcatedarik_manufacturer_id era)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'dinamik_brand'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'dbrands_id'
  ) THEN
    ALTER TABLE parcatedarik.dbrands_match RENAME COLUMN dinamik_brand TO dbrands_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'parcatedarik_manufacturer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'manufacturer_id'
  ) THEN
    ALTER TABLE parcatedarik.dbrands_match RENAME COLUMN parcatedarik_manufacturer_id TO manufacturer_id;
  END IF;
END $$;

-- 2) normalized: single column used by app (UI "normalizedName" maps here)
ALTER TABLE parcatedarik.dbrands_match ADD COLUMN IF NOT EXISTS normalized TEXT;

DO $$
DECLARE
  parts text[] := ARRAY['NULLIF(BTRIM(normalized), '''')'];
  sql text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'normalized_name'
  ) THEN
    parts := parts || ARRAY['NULLIF(BTRIM(normalized_name), '''')'];
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'normalized_pc_manufacturer'
  ) THEN
    parts := parts || ARRAY['NULLIF(BTRIM(normalized_pc_manufacturer), '''')'];
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'normalized_dinamik_brand'
  ) THEN
    parts := parts || ARRAY['NULLIF(BTRIM(normalized_dinamik_brand), '''')'];
  END IF;

  sql := format(
    'UPDATE parcatedarik.dbrands_match SET normalized = COALESCE(%s) WHERE normalized IS NULL OR BTRIM(COALESCE(normalized, '''')) = ''''',
    array_to_string(parts, ', ')
  );
  EXECUTE sql;
END $$;

-- 3) text dbrands_id (brand name) → bigint FK to dbrands.id
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'parcatedarik'
    AND table_name = 'dbrands_match'
    AND column_name = 'dbrands_id';

  IF col_type IS NULL OR col_type NOT IN ('text', 'character varying') THEN
    RETURN;
  END IF;

  DROP INDEX IF EXISTS parcatedarik.idx_dbrands_match_dbrands_id_trgm;
  DROP INDEX IF EXISTS parcatedarik.uq_dbrands_match_dbrand_only;
  DROP INDEX IF EXISTS parcatedarik.uq_dbrands_match_pt_only_mfr;

  ALTER TABLE parcatedarik.dbrands_match
    DROP CONSTRAINT IF EXISTS fk_dbrands_match_brand;

  ALTER TABLE parcatedarik.dbrands_match
    ADD COLUMN IF NOT EXISTS dbrands_fk bigint;

  UPDATE parcatedarik.dbrands_match m
  SET dbrands_fk = d.id
  FROM parcatedarik.dbrands d
  WHERE m.dbrands_id IS NOT NULL
    AND d.brand = m.dbrands_id;

  DELETE FROM parcatedarik.dbrands_match
  WHERE dbrands_id IS NOT NULL
    AND dbrands_fk IS NULL;

  ALTER TABLE parcatedarik.dbrands_match DROP COLUMN dbrands_id;
  ALTER TABLE parcatedarik.dbrands_match RENAME COLUMN dbrands_fk TO dbrands_id;
END $$;

-- 4) Orphan temp column if a previous run failed after rename
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'dbrands_fk'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'parcatedarik' AND table_name = 'dbrands_match' AND column_name = 'dbrands_id'
  ) THEN
    UPDATE parcatedarik.dbrands_match m
    SET dbrands_id = COALESCE(m.dbrands_id, m.dbrands_fk)
    WHERE m.dbrands_id IS NULL AND m.dbrands_fk IS NOT NULL;

    ALTER TABLE parcatedarik.dbrands_match DROP COLUMN dbrands_fk;
  END IF;
END $$;

-- 5) FK + partial unique indexes (bigint dbrands_id)
ALTER TABLE parcatedarik.dbrands_match
  DROP CONSTRAINT IF EXISTS fk_dbrands_match_brand;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_dbrands_match_brand'
      AND conrelid = 'parcatedarik.dbrands_match'::regclass
  ) THEN
    ALTER TABLE parcatedarik.dbrands_match
      ADD CONSTRAINT fk_dbrands_match_brand
      FOREIGN KEY (dbrands_id) REFERENCES parcatedarik.dbrands (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_dbrand_only
  ON parcatedarik.dbrands_match (dbrands_id)
  WHERE manufacturer_id IS NULL AND dbrands_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_pt_only_mfr
  ON parcatedarik.dbrands_match (manufacturer_id)
  WHERE dbrands_id IS NULL AND manufacturer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dbrands_match_dbrands_id
  ON parcatedarik.dbrands_match (dbrands_id)
  WHERE dbrands_id IS NOT NULL;

-- 6) Drop deprecated columns (normalized_name was interim; brand text lives on dbrands.brand)
DROP INDEX IF EXISTS parcatedarik.dpba_normalized_name;
DROP INDEX IF EXISTS parcatedarik.dpba_normalized_dinamik_brand;
DROP INDEX IF EXISTS parcatedarik.dpba_parcatedarik_manufacturer_id;
DROP INDEX IF EXISTS parcatedarik.dpba_unique_brand_manufacturer;

ALTER TABLE parcatedarik.dbrands_match
  DROP COLUMN IF EXISTS normalized_name,
  DROP COLUMN IF EXISTS normalized_dinamik_brand,
  DROP COLUMN IF EXISTS normalized_pc_manufacturer,
  DROP COLUMN IF EXISTS confidence,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

COMMENT ON COLUMN parcatedarik.dbrands_match.dbrands_id IS 'FK → parcatedarik.dbrands.id (Dinamik marka kaydı; marka metni dbrands.brand)';
COMMENT ON COLUMN parcatedarik.dbrands_match.normalized IS 'Normalize edilmiş PT üretici adı (eşleştirme / arama); UI normalizedName';
