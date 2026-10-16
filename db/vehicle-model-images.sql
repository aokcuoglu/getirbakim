-- Photographs of TecDoc model series (vehicle_models) matched from Wikidata (P18) and downloaded from Wikimedia
-- Commons by scripts/vehicle-model-images.ts. Bytes live in object storage as product_media_objects rows; the
-- storefront only shows approved rows and always carries the author/licence attribution the licence requires.
CREATE TABLE IF NOT EXISTS vehicle_model_images (
 model_id integer PRIMARY KEY REFERENCES vehicle_models(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES product_media_objects(id),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
 wikidata_id text NOT NULL CHECK (wikidata_id ~ '^Q[0-9]+$'),
 wikidata_label text NOT NULL,
 commons_file text NOT NULL,
 source_url text NOT NULL,
 license text NOT NULL,
 license_url text,
 author text,
 -- generation: the Wikidata item is the model series itself (or the model has a single generation);
 -- family: only the model family matched although the TecDoc name carries a generation marker.
 match_kind text NOT NULL CHECK (match_kind IN ('generation','family')),
 matched_query text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 imported_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS vehicle_model_images_status_idx ON vehicle_model_images(status, match_kind);

-- One row per matching attempt so re-runs skip settled models; misses are retried only with --retry.
CREATE TABLE IF NOT EXISTS vehicle_model_image_lookups (
 model_id integer PRIMARY KEY REFERENCES vehicle_models(id) ON DELETE CASCADE,
 outcome text NOT NULL CHECK (outcome IN ('matched','none','error')),
 detail text,
 queries text[] NOT NULL,
 attempted_at timestamptz NOT NULL DEFAULT now()
);
