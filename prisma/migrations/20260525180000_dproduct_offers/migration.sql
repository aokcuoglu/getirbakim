-- Volatile Dinamik offer data (price, stock, API raw) separated from dproducts master.

CREATE TABLE IF NOT EXISTS parcatedarik.dproduct_offers (
  id              BIGSERIAL PRIMARY KEY,
  dproduct_id     BIGINT NOT NULL REFERENCES parcatedarik.dproducts (id) ON DELETE CASCADE,
  price           NUMERIC(10, 2),
  stock_qty       INTEGER,
  campaign_rate   NUMERIC(6, 3),
  regional_stock  JSONB,
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          TEXT NOT NULL DEFAULT 'dinamik',
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dproduct_offers_dproduct_id UNIQUE (dproduct_id)
);

CREATE INDEX IF NOT EXISTS idx_dproduct_offers_last_seen
  ON parcatedarik.dproduct_offers (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_dproduct_offers_price
  ON parcatedarik.dproduct_offers (price)
  WHERE price IS NOT NULL;

CREATE TABLE IF NOT EXISTS parcatedarik.dproduct_offer_history (
  id           BIGSERIAL PRIMARY KEY,
  dproduct_id  BIGINT NOT NULL REFERENCES parcatedarik.dproducts (id) ON DELETE CASCADE,
  price        NUMERIC(10, 2),
  stock_qty    INTEGER,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dproduct_offer_history_product_time
  ON parcatedarik.dproduct_offer_history (dproduct_id, captured_at DESC);

-- Backfill current snapshot from legacy columns on dproducts.
INSERT INTO parcatedarik.dproduct_offers (
  dproduct_id,
  price,
  stock_qty,
  raw,
  source,
  last_seen_at,
  updated_at
)
SELECT
  d.id,
  d.price,
  NULLIF(
    TRIM(BOTH FROM COALESCE(d.raw ->> 'stokAdedi', '')),
    ''
  )::int,
  COALESCE(d.raw, '{}'::jsonb),
  'dinamik',
  COALESCE(d.last_seen_at, d.updated_at, NOW()),
  COALESCE(d.updated_at, NOW())
FROM parcatedarik.dproducts d
ON CONFLICT (dproduct_id) DO UPDATE SET
  price = COALESCE(EXCLUDED.price, parcatedarik.dproduct_offers.price),
  raw = EXCLUDED.raw,
  last_seen_at = GREATEST(
    parcatedarik.dproduct_offers.last_seen_at,
    EXCLUDED.last_seen_at
  ),
  updated_at = NOW();
