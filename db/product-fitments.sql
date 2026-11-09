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

-- Model-level fitment read from the supplier's own product description (#392) for products without an engine-level
-- TecDoc enrichment. Rebuilt by `npm run fitment:descriptions`; it never names an engine type, so the storefront
-- shows it as "model matches, engine type not verified".
CREATE TABLE IF NOT EXISTS product_model_fitments (
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
 model_id integer NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
 year_from integer CHECK (year_from BETWEEN 1950 AND 2100),
 year_to integer CHECK (year_to BETWEEN 1950 AND 2100),
 source_text text NOT NULL,
 derived_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(supplier_item_id,model_id),
 CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from)
);
CREATE INDEX IF NOT EXISTS product_model_fitments_model_idx ON product_model_fitments(model_id);
