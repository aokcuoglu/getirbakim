-- Make parcatedarik_manufacturer_id nullable to support unmatched brands
ALTER TABLE parcatedarik.dbrands_match ALTER COLUMN parcatedarik_manufacturer_id DROP NOT NULL;
