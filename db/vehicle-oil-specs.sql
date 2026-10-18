-- Recommended engine oil per vehicle type (data/vehicle_type_oil_specs.csv, `npm run db:vehicle-oils`).
-- Kept apart from vehicle_types so the TecDoc import and this list are reloaded independently.
-- Values are normalised by the import: viscosities '5W-30', ACEA 'C3' / 'A3/B4', API 'SN', approvals as listed ('VW 504.00').
CREATE TABLE IF NOT EXISTS vehicle_type_oil_specs (
 vehicle_type_id integer PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
 viscosities text[] NOT NULL CHECK (cardinality(viscosities) > 0),
 acea text[] NOT NULL DEFAULT '{}',
 api text[] NOT NULL DEFAULT '{}',
 approvals text[] NOT NULL DEFAULT '{}',
 -- Litres with an oil-filter change; a single figure has min = max.
 capacity_min_l numeric(4,1) NOT NULL CHECK (capacity_min_l > 0),
 capacity_max_l numeric(4,1) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (capacity_max_l >= capacity_min_l)
);
