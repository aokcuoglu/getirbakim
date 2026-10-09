CREATE TABLE IF NOT EXISTS enrichment_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seed text NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','running','complete','blocked','stopped')),
 sample_size integer NOT NULL CHECK(sample_size>0),
 cache_hits integer NOT NULL DEFAULT 0, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS enrichment_run_items (
 run_id uuid NOT NULL REFERENCES enrichment_runs(id),
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id), ordinal integer NOT NULL,
 supplier_code text NOT NULL,supplier_brand text NOT NULL,oem text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','collecting','complete','partial','review','not_found','failed','blocked')),
 stage text NOT NULL DEFAULT 'search', checkpoint jsonb NOT NULL DEFAULT '{}',
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 last_error text, started_at timestamptz, finished_at timestamptz,
 PRIMARY KEY(run_id,supplier_item_id), UNIQUE(run_id,ordinal)
);
CREATE INDEX IF NOT EXISTS enrichment_run_items_queue_idx ON enrichment_run_items(run_id,status,ordinal);
CREATE TABLE IF NOT EXISTS enrichment_source_hosts (
 host text PRIMARY KEY CHECK(host IN ('www.trodo.com','picdn.trodo.com')),
 interval_ms integer NOT NULL DEFAULT 2500 CHECK(interval_ms>=2500),
 next_allowed_at timestamptz NOT NULL DEFAULT now(),
 blocked boolean NOT NULL DEFAULT false,last_error text
);
ALTER TABLE enrichment_source_hosts ADD COLUMN IF NOT EXISTS challenge_since timestamptz;
ALTER TABLE enrichment_source_hosts ADD COLUMN IF NOT EXISTS challenges integer NOT NULL DEFAULT 0;
INSERT INTO enrichment_source_hosts(host) VALUES('www.trodo.com'),('picdn.trodo.com') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS enrichment_source_cache (
 host text NOT NULL,path text NOT NULL,body jsonb NOT NULL,fetched_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,PRIMARY KEY(host,path)
);
CREATE TABLE IF NOT EXISTS enrichment_source_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES enrichment_runs(id),
 host text NOT NULL REFERENCES enrichment_source_hosts(host),path text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('json','image','logo','html')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','complete','failed','blocked')),
 available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,last_error text,body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(run_id,host,path)
);
CREATE INDEX IF NOT EXISTS enrichment_source_requests_queue_idx ON enrichment_source_requests(host,status,available_at);
CREATE TABLE IF NOT EXISTS enrichment_request_events (
 id bigserial PRIMARY KEY,run_id uuid NOT NULL REFERENCES enrichment_runs(id),request_id uuid REFERENCES enrichment_source_requests(id),
 host text NOT NULL,path text NOT NULL,http_status integer,elapsed_ms integer NOT NULL DEFAULT 0,
 bytes integer NOT NULL DEFAULT 0,outcome text NOT NULL,retry_after_ms integer,created_at timestamptz NOT NULL DEFAULT now()
);
-- Statement triggers invalidate the in-memory matcher even for manual catalog writes.
CREATE TABLE IF NOT EXISTS vehicle_catalog_revision(id boolean PRIMARY KEY DEFAULT true CHECK(id),revision bigint NOT NULL DEFAULT 1);
INSERT INTO vehicle_catalog_revision(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION bump_vehicle_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE vehicle_catalog_revision SET revision=revision+1 WHERE id=true; RETURN NULL; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='vehicle_brands_revision') THEN
 CREATE TRIGGER vehicle_brands_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON vehicle_brands FOR EACH STATEMENT EXECUTE FUNCTION bump_vehicle_catalog_revision();
 CREATE TRIGGER vehicle_models_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON vehicle_models FOR EACH STATEMENT EXECUTE FUNCTION bump_vehicle_catalog_revision();
 CREATE TRIGGER vehicle_types_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON vehicle_types FOR EACH STATEMENT EXECUTE FUNCTION bump_vehicle_catalog_revision();
 END IF;
END $$;
