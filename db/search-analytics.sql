-- Search analytics and admin-managed synonyms (#822).
-- search_query_stats: one row per day, search mode and normalized query (src/modules/search/query.ts
-- normalizeSearchText). No account, session or IP is kept: the table only counts what shoppers searched.
-- Rows older than 180 days are deleted by recordSearch (src/modules/search/analytics.ts).
CREATE TABLE IF NOT EXISTS search_query_stats (
 day date NOT NULL,
 mode text NOT NULL CHECK (mode IN ('all','code')),
 query text NOT NULL CHECK (length(query) BETWEEN 1 AND 120),
 searches integer NOT NULL DEFAULT 0,
 zero_results integer NOT NULL DEFAULT 0,
 last_total integer NOT NULL DEFAULT 0,
 corrected_query text,
 last_searched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (day, mode, query)
);
CREATE INDEX IF NOT EXISTS search_query_stats_query_idx ON search_query_stats (query);

-- Synonym groups an admin added on /yonetim/arama, merged with the built-in groups of query.ts. Words are stored
-- normalized ("sogutma sivisi"); a word may be a phrase of up to four words.
CREATE TABLE IF NOT EXISTS search_synonyms (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 words text[] NOT NULL CHECK (cardinality(words) BETWEEN 2 AND 12),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
