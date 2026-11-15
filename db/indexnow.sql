-- IndexNow (#645): the last state reported to search engines for each indexable product page. A daily run
-- (scripts/indexnow.ts) compares the indexable pages with these rows and reports only the difference. No foreign key:
-- the row of a deleted or deactivated product stays until its removal has been reported.
CREATE TABLE IF NOT EXISTS indexnow_urls (
 product_id uuid PRIMARY KEY,
 path text NOT NULL,
 fingerprint uuid NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now()
);

-- One row per run; `next_chunk` is the sitemap chunk the next run starts with.
CREATE TABLE IF NOT EXISTS indexnow_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 mode text NOT NULL CHECK (mode IN ('send','seed')),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed')),
 next_chunk integer NOT NULL DEFAULT 0,
 checked integer NOT NULL DEFAULT 0,
 added integer NOT NULL DEFAULT 0,
 changed integer NOT NULL DEFAULT 0,
 removed integer NOT NULL DEFAULT 0,
 submitted integer NOT NULL DEFAULT 0,
 requests integer NOT NULL DEFAULT 0,
 last_http_status integer,
 error text
);
