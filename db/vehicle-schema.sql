-- TecDoc numeric IDs are preserved as primary keys. Dates have month precision.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE TABLE IF NOT EXISTS vehicle_brands (
 id integer PRIMARY KEY CHECK (id > 0),
 name text NOT NULL CHECK (length(name) > 0),
 display_name text NOT NULL CHECK (length(display_name) > 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- Popular makes come from popularVehicleMakes since #913; older databases still carry the unread flag (#944).
ALTER TABLE vehicle_brands DROP COLUMN IF EXISTS popular;

CREATE TABLE IF NOT EXISTS vehicle_models (
 id integer PRIMARY KEY CHECK (id > 0),
 brand_id integer NOT NULL REFERENCES vehicle_brands(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK (length(name) > 0),
 date_from date,
 date_to date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (date_from IS NULL OR extract(day FROM date_from) = 1),
 CHECK (date_to IS NULL OR extract(day FROM date_to) = 1),
 CHECK (date_from IS NULL OR date_to IS NULL OR date_to >= date_from)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='vehicle_models'::regclass AND c.relname='vehicle_models_brand_idx') THEN
  CREATE INDEX vehicle_models_brand_idx ON vehicle_models(brand_id, name, id);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS vehicle_types (
 id integer PRIMARY KEY CHECK (id > 0),
 model_id integer NOT NULL REFERENCES vehicle_models(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK (length(name) > 0),
 cc integer CHECK (cc > 0),
 fuel_type text NOT NULL CHECK (length(fuel_type) > 0),
 fuel_name text NOT NULL CHECK (length(fuel_name) > 0),
 hp integer NOT NULL CHECK (hp > 0),
 kwt integer NOT NULL CHECK (kwt > 0),
 year_of_constr_from date NOT NULL,
 year_of_constr_to date,
 -- Import maintains normalized brand/model/engine/fuel/power aliases for substring search.
 search_text text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (extract(day FROM year_of_constr_from) = 1),
 CHECK (year_of_constr_to IS NULL OR extract(day FROM year_of_constr_to) = 1),
 CHECK (year_of_constr_to IS NULL OR year_of_constr_to >= year_of_constr_from)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='vehicle_types'::regclass AND c.relname='vehicle_types_model_fuel_idx') THEN
  CREATE INDEX vehicle_types_model_fuel_idx ON vehicle_types(model_id, fuel_name, name, id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='vehicle_types'::regclass AND c.relname='vehicle_types_search_idx') THEN
  CREATE INDEX vehicle_types_search_idx ON vehicle_types USING gin(search_text gin_trgm_ops);
 END IF;
END $$;
