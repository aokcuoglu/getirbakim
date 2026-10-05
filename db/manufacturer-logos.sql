CREATE TABLE IF NOT EXISTS manufacturer_logos (
 brand_key text PRIMARY KEY CHECK (brand_key ~ '^[A-Z0-9]{1,100}$'),
 manufacturer text NOT NULL,
 image_data bytea NOT NULL CHECK (octet_length(image_data) BETWEEN 1 AND 1048576),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
 source_url text NOT NULL,
 evidence_product_id uuid REFERENCES supplier_items(id) ON DELETE SET NULL,
 evidence_source_url text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
