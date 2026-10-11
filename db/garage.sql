-- Vehicles saved by signed-in accounts (B2B services keep many customer vehicles). Guests keep theirs in a cookie.
-- vehicle_key identifies the vehicle: catalog type and model year, or the free-text make/model/year.
CREATE TABLE IF NOT EXISTS account_vehicles (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 vehicle_key text NOT NULL CHECK(length(vehicle_key) BETWEEN 1 AND 200),
 vehicle jsonb NOT NULL CHECK(jsonb_typeof(vehicle)='object'),
 selected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,vehicle_key)
);
CREATE INDEX IF NOT EXISTS account_vehicles_recent_idx ON account_vehicles(account_id,selected_at DESC);
