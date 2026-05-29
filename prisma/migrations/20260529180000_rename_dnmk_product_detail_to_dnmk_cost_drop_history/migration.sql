-- Rename dnmk_product_detail -> dnmk_cost
ALTER TABLE v0.dnmk_product_detail RENAME TO dnmk_cost;

-- Drop dnmk_product_history
DROP TABLE v0.dnmk_product_history;