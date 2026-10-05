-- One retained source observation per product and source row. Only unique strict
-- catalog matches carry a FK; unmatched observations remain available for review.
CREATE TABLE IF NOT EXISTS product_vehicle_fitments (
 supplier_item_id uuid NOT NULL REFERENCES product_enrichments(supplier_item_id) ON DELETE CASCADE,
 source_index integer NOT NULL CHECK (source_index >= 0),
 source_vehicle jsonb NOT NULL CHECK (jsonb_typeof(source_vehicle)='object'),
 vehicle_type_id integer REFERENCES vehicle_types(id) ON DELETE RESTRICT,
 match_status text NOT NULL CHECK (match_status IN ('matched','model_missing','attributes_missing','dates_differ','engine_name_differs','ambiguous')),
 candidate_type_ids integer[] NOT NULL DEFAULT '{}',
 matcher_version text NOT NULL,
 matched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(supplier_item_id,source_index),
 CHECK ((match_status='matched') = (vehicle_type_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS product_vehicle_fitments_type_idx
 ON product_vehicle_fitments(vehicle_type_id,supplier_item_id) WHERE vehicle_type_id IS NOT NULL;
