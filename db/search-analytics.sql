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
-- Products of the latest search's first page shown under an English supplier name translated to Turkish (#989): how
-- much the type-name expansion ("kapı camı" → DOOR GLASS) fills the first page. NULL for queries that name no type, code
-- searches and rows recorded before the column.
ALTER TABLE search_query_stats ADD COLUMN IF NOT EXISTS last_type_name_first_page smallint;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='search_query_stats'::regclass AND c.relname='search_query_stats_query_idx') THEN
  CREATE INDEX search_query_stats_query_idx ON search_query_stats (query);
 END IF;
END $$;

-- Synonym groups an admin added on /yonetim/arama, merged with the built-in groups of query.ts. Words are stored
-- normalized ("sogutma sivisi"); a word may be a phrase of up to four words.
CREATE TABLE IF NOT EXISTS search_synonyms (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 words text[] NOT NULL CHECK (cardinality(words) BETWEEN 2 AND 12),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- AI-suggested synonym groups (#834) waiting for an admin's decision on /yonetim/arama. group_key is the sorted
-- normalized spellings: a group suggested once (pending, approved or rejected) is never suggested again.
CREATE TABLE IF NOT EXISTS search_synonym_suggestions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_key text NOT NULL UNIQUE,
 words text[] NOT NULL CHECK (cardinality(words) BETWEEN 2 AND 12),
 source text NOT NULL CHECK (source IN ('zero_result','vocabulary')),
 query text,
 reason text NOT NULL DEFAULT '',
 hits integer NOT NULL DEFAULT 0,
 model text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid REFERENCES accounts(id) ON DELETE SET NULL
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='search_synonym_suggestions'::regclass AND c.relname='search_synonym_suggestions_pending_idx') THEN
  CREATE INDEX search_synonym_suggestions_pending_idx ON search_synonym_suggestions (created_at DESC) WHERE status = 'pending';
 END IF;
END $$;
-- Inputs already sent to the model ("q:<query>", "pair:<a>|<b>"), so a run does not pay for them again; a zero-result
-- query is retried after 30 days (new catalog words may answer it by then).
CREATE TABLE IF NOT EXISTS search_suggestion_checks (
 key text PRIMARY KEY,
 checked_at timestamptz NOT NULL DEFAULT now()
);
