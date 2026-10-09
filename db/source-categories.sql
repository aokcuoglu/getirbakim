CREATE TABLE IF NOT EXISTS source_categories (
 source text NOT NULL, category_id integer NOT NULL CHECK(category_id>0),
 parent_id integer, name text NOT NULL, slug text NOT NULL,
 path_ids integer[] NOT NULL, source_url text NOT NULL, raw jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,category_id)
);
CREATE INDEX IF NOT EXISTS source_categories_parent_idx ON source_categories(source,parent_id);
CREATE TABLE IF NOT EXISTS source_category_labels (
 source text NOT NULL, category_id integer NOT NULL, locale text NOT NULL,
 name text NOT NULL, slug text NOT NULL,
 PRIMARY KEY(source,category_id,locale), UNIQUE(locale,slug),
 FOREIGN KEY(source,category_id) REFERENCES source_categories(source,category_id)
);
CREATE TABLE IF NOT EXISTS product_source_categories (
 supplier_item_id uuid NOT NULL REFERENCES supplier_items(id),
 source text NOT NULL, category_id integer NOT NULL,
 PRIMARY KEY(supplier_item_id,source,category_id),
 FOREIGN KEY(source,category_id) REFERENCES source_categories(source,category_id)
);
CREATE INDEX IF NOT EXISTS product_source_categories_category_idx ON product_source_categories(source,category_id,supplier_item_id);
CREATE TABLE IF NOT EXISTS source_category_images (
 source text NOT NULL, category_id integer NOT NULL,media_id uuid NOT NULL REFERENCES product_media_objects(id),
 width integer NOT NULL,height integer NOT NULL,
 PRIMARY KEY(source,category_id),FOREIGN KEY(source,category_id) REFERENCES source_categories(source,category_id)
);
CREATE TABLE IF NOT EXISTS category_image_jobs (
 source text NOT NULL,category_id integer NOT NULL,path text NOT NULL,
 status text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,
 last_error text,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,category_id),FOREIGN KEY(source,category_id) REFERENCES source_categories(source,category_id)
);
