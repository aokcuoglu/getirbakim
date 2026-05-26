-- Add logo_url to v0.dbrands_match (denormalized brand logo for home page / brand pages)
ALTER TABLE v0.dbrands_match
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN v0.dbrands_match.logo_url IS 'Brand logo URL; backfilled from ptbrands.logo_url with part_brands fallback';
