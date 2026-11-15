-- Storefront code search over enrichment OEM numbers (#609). Needs db/search.sql (search_compact, pg_trgm) and
-- db/product-enrichment.sql (product_enrichments); kept apart so the enrichment schema loads without the search engine.
-- Every OEM number of an enrichment, compacted (search_compact) and space-separated, for the storefront's code
-- search (#609): computed per query over every enrichment it took ~3 s. The index only narrows the rows;
-- searchHits (src/modules/store/catalog.ts) still checks each number. IMMUTABLE and indexed: changing this or
-- search_compact requires REINDEX INDEX product_enrichments_oem_search_idx. The SET clause keeps it from being
-- inlined, so the query's call matches the index expression. Non-object/non-array values yield nothing instead
-- of failing a write.
CREATE OR REPLACE FUNCTION enrichment_oem_search(payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path FROM CURRENT AS $$
 SELECT COALESCE(string_agg(search_compact(reference.number), ' '), '')
 FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'oemNumbers')='object' THEN payload->'oemNumbers' END) refs
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(refs.value)='array' THEN refs.value END) reference(number)
$$;
CREATE INDEX IF NOT EXISTS product_enrichments_oem_search_idx ON product_enrichments
 USING gin (enrichment_oem_search(payload) gin_trgm_ops);
-- Expression statistics exist only after ANALYZE (see db/search.sql); only the first run pays for it.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_stats WHERE schemaname=current_schema() AND tablename='product_enrichments_oem_search_idx') THEN
  ANALYZE product_enrichments;
 END IF;
END $$;
