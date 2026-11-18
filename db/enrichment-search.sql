-- Storefront code search over enrichment OEM numbers (#609) and the /yonetim/urun-verileri search (#617). Needs
-- db/search.sql (search_compact, pg_trgm), db/product-enrichment.sql (product_enrichments) and db/enrichment-states.sql
-- (enrichment_product_states); kept apart so the enrichment schema loads without the search engine.
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
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_enrichments'::regclass AND c.relname='product_enrichments_oem_search_idx') THEN
  CREATE INDEX product_enrichments_oem_search_idx ON product_enrichments
   USING gin (enrichment_oem_search(payload) gin_trgm_ops);
 END IF;
END $$;
-- Expression statistics exist only after ANALYZE (see db/search.sql); only the first run pays for it.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_stats WHERE schemaname=current_schema() AND tablename='product_enrichments_oem_search_idx') THEN
  ANALYZE product_enrichments;
 END IF;
END $$;
-- /yonetim/urun-verileri search by manufacturer part number (#617). Only enriched products carry one (~80k of ~780k
-- rows), so the index is partial; the query repeats the predicate. Same REINDEX rule as above when search_compact changes.
CREATE INDEX IF NOT EXISTS enrichment_product_states_part_number_search_idx ON enrichment_product_states
 USING gin (search_compact(manufacturer_part_number) gin_trgm_ops) WHERE manufacturer_part_number IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_stats WHERE schemaname=current_schema() AND tablename='enrichment_product_states_part_number_search_idx') THEN
  ANALYZE enrichment_product_states;
 END IF;
END $$;
