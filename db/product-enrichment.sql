-- External content is never written into supplier_items.product_data.
CREATE TABLE IF NOT EXISTS product_media_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bucket text NOT NULL, object_key text NOT NULL,
 sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 content_type text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png')),
 size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
 source_url text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bucket,object_key)
);
CREATE TABLE IF NOT EXISTS product_enrichments (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 supplier_code text NOT NULL, supplier_brand text NOT NULL,
 source_url text NOT NULL, source_method text NOT NULL,
 manufacturer text NOT NULL, manufacturer_part_number text NOT NULL,
 image_id uuid REFERENCES product_media_objects(id),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE product_enrichments ADD COLUMN IF NOT EXISTS match_basis jsonb NOT NULL DEFAULT '{"type":"exact_part"}';
CREATE TABLE IF NOT EXISTS product_enrichment_jobs (
 supplier_item_id uuid PRIMARY KEY REFERENCES supplier_items(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','partial','not_found','review','blocked','failed')),
 supplier_code text NOT NULL, supplier_brand text NOT NULL, oem text NOT NULL DEFAULT '',
 candidate_url text, attempts integer NOT NULL DEFAULT 0,
 last_error text, last_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_enrichment_jobs_pending_idx ON product_enrichment_jobs(status,supplier_item_id);
CREATE TABLE IF NOT EXISTS product_enrichment_sources (
 host text PRIMARY KEY, probe_url text NOT NULL, http_status integer,
 status text NOT NULL CHECK(status IN ('accessible','blocked','error')),
 checked_at timestamptz NOT NULL DEFAULT now()
);
-- Public vehicle responses are reusable across many products.
CREATE TABLE IF NOT EXISTS product_enrichment_vehicle_cache (
 source_host text NOT NULL,
 resource_path text NOT NULL,
 payload jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_host,resource_path)
);
