-- Allow one dproduct ↔ many ptproducts (and vice versa) via multiple paired rows.
-- Keeps at most one dinamik-only or pt-only placeholder per product side.

DROP INDEX IF EXISTS v0.uq_dpmatch_dproducts_id;
DROP INDEX IF EXISTS v0.uq_dpmatch_ptproducts_id;

-- Prevent duplicate (dproducts_id, ptproducts_id) pairs when both sides are set.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_pair
  ON v0.dpmatch (dproducts_id, ptproducts_id)
  WHERE dproducts_id IS NOT NULL AND ptproducts_id IS NOT NULL;

-- One dinamik-only placeholder row per dproduct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_dproducts_only
  ON v0.dpmatch (dproducts_id)
  WHERE dproducts_id IS NOT NULL AND ptproducts_id IS NULL;

-- One pt-only placeholder row per ptproduct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_ptproducts_only
  ON v0.dpmatch (ptproducts_id)
  WHERE dproducts_id IS NULL AND ptproducts_id IS NOT NULL;

COMMENT ON INDEX v0.uq_dpmatch_pair IS
  'Unique paired match: one row per (dproducts_id, ptproducts_id); allows many pairs per product.';
COMMENT ON INDEX v0.uq_dpmatch_dproducts_only IS
  'At most one Dinamik-only placeholder per dproducts_id.';
COMMENT ON INDEX v0.uq_dpmatch_ptproducts_only IS
  'At most one PT-only placeholder per ptproducts_id.';
