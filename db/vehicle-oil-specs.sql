-- Recommended engine oil per vehicle type (data/vehicle_type_oil_specs.csv, `npm run db:vehicle-oils`).
-- Kept apart from vehicle_types so the TecDoc import and this list are reloaded independently.
-- Values are normalised by the import: viscosities '5W-30', ACEA 'C3' / 'A3/B4', API 'SN', approvals as listed ('VW 504.00').
-- Single grades read '30'. A source may lack the grade or the capacity; a row still states at least one fact.
CREATE TABLE IF NOT EXISTS vehicle_type_oil_specs (
 vehicle_type_id integer PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
 viscosities text[] NOT NULL DEFAULT '{}',
 acea text[] NOT NULL DEFAULT '{}',
 api text[] NOT NULL DEFAULT '{}',
 approvals text[] NOT NULL DEFAULT '{}',
 -- Litres with an oil-filter change; a single figure has min = max, unknown is both NULL.
 capacity_min_l numeric(4,1) CHECK (capacity_min_l > 0),
 capacity_max_l numeric(4,1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (capacity_max_l >= capacity_min_l)
);
-- Tables created when every row needed a grade and a capacity.
ALTER TABLE vehicle_type_oil_specs DROP CONSTRAINT IF EXISTS vehicle_type_oil_specs_viscosities_check;
ALTER TABLE vehicle_type_oil_specs ALTER COLUMN viscosities SET DEFAULT '{}', ALTER COLUMN capacity_min_l DROP NOT NULL,
 ALTER COLUMN capacity_max_l DROP NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='vehicle_type_oil_specs'::regclass AND conname='vehicle_type_oil_specs_capacity_pair') THEN
  ALTER TABLE vehicle_type_oil_specs ADD CONSTRAINT vehicle_type_oil_specs_capacity_pair CHECK ((capacity_min_l IS NULL) = (capacity_max_l IS NULL));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='vehicle_type_oil_specs'::regclass AND conname='vehicle_type_oil_specs_not_empty') THEN
  ALTER TABLE vehicle_type_oil_specs ADD CONSTRAINT vehicle_type_oil_specs_not_empty
   CHECK (cardinality(viscosities) + cardinality(acea) + cardinality(api) + cardinality(approvals) > 0 OR capacity_min_l IS NOT NULL);
 END IF;
END $$;

-- Trodo's engine-oil data per vehicle type (scripts/vehicle-oil-trodo.ts), as the source states it: litres ("3,70"),
-- SAE grades ("SAE 5W-30") and specifications ("VW 507 00", "API SL", "ACEA C3"). Empty arrays mean Trodo has no oil
-- data for the car. `npm run vehicles:oil-trodo -- export` merges these rows into data/vehicle_type_oil_specs.csv.
CREATE TABLE IF NOT EXISTS vehicle_type_trodo_oils (
 vehicle_type_id integer PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
 trodo_car_id integer NOT NULL CHECK (trodo_car_id > 0),
 rmi_car_id text,
 volumes text[] NOT NULL DEFAULT '{}',
 viscosities text[] NOT NULL DEFAULT '{}',
 specifications text[] NOT NULL DEFAULT '{}',
 fetched_at timestamptz NOT NULL DEFAULT now()
);
