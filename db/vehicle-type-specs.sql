-- Technical data and photographs of TecDoc vehicle types read from REPXPERT (Schaeffler's TecDoc catalogue) by
-- scripts/vehicle-repxpert.ts. REPXPERT addresses a type as "TA-<TecDoc type number>", which is vehicle_types.id, so
-- rows join directly. The raw response is kept so further fields can be read without fetching again.
CREATE TABLE IF NOT EXISTS vehicle_type_specs (
 vehicle_type_id integer PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
 -- found: specs stored; missing: REPXPERT does not know the type; error: retried on the next run.
 outcome text NOT NULL CHECK (outcome IN ('found','missing','error')),
 detail text,
 full_name text,
 body_type text,
 drive_type text,
 engine_type text,
 fuel_mixture text,
 cylinders smallint,
 valves smallint,
 engine_codes text[] NOT NULL DEFAULT '{}',
 kba_numbers text[] NOT NULL DEFAULT '{}',
 payload jsonb,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_type_specs_outcome_idx ON vehicle_type_specs(outcome);
CREATE INDEX IF NOT EXISTS vehicle_type_specs_engine_codes_idx ON vehicle_type_specs USING gin(engine_codes);

-- The type's side-view picture as a WebP copy in object storage; types sharing a picture share one media object.
CREATE TABLE IF NOT EXISTS vehicle_type_images (
 vehicle_type_id integer PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES product_media_objects(id),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_type_images_media_idx ON vehicle_type_images(media_id);
-- Set once scripts/vehicle-image-cutout.ts replaced media_id with a transparent cut-out: the REPXPERT original it came from.
ALTER TABLE vehicle_type_images ADD COLUMN IF NOT EXISTS original_media_id uuid REFERENCES product_media_objects(id);
