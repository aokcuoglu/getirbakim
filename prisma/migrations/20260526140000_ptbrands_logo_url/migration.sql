-- Add logo_url to v0.ptbrands (ParcaTedarik manufacturer logos)
ALTER TABLE v0.ptbrands
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN v0.ptbrands.logo_url IS 'ParcaTedarik manufacturer logo URL (from parcatedarik.com)';
