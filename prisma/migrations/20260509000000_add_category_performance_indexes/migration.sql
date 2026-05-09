-- v0.2.3: Add composite index for category slug resolution performance
-- The getPartCategoryByUrlKey function queries part_categories with
-- WHERE is_active = true AND url_key = <value> frequently.
-- The existing single-column indexes on [is_active] and [url_key] cannot
-- be efficiently combined for this query pattern.

-- Composite index for active category url_key lookups
CREATE INDEX IF NOT EXISTS part_categories_active_url_key_idx
  ON part_categories (is_active, url_key);