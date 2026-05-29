-- Rename v0 schema tables for consistency

ALTER TABLE v0.dbrands RENAME TO dnbrd;
ALTER TABLE v0.dbrands_match RENAME TO dpbrd;
ALTER TABLE v0.dpmatch RENAME TO dpprd;
ALTER TABLE v0.dproduct_details RENAME TO dnprdt;
ALTER TABLE v0.dproduct_history RENAME TO dnprdh;
ALTER TABLE v0.dproducts RENAME TO dnprd;
ALTER TABLE v0.ptbrands RENAME TO ptbrd;
ALTER TABLE v0.ptproducts RENAME TO ptprd;
