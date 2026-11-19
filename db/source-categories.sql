CREATE TABLE IF NOT EXISTS source_categories (
 source text NOT NULL, category_id integer NOT NULL CHECK(category_id>0),
 parent_id integer, name text NOT NULL, slug text NOT NULL,
 path_ids integer[] NOT NULL, source_url text NOT NULL, raw jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,category_id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='source_categories'::regclass AND c.relname='source_categories_parent_idx') THEN
  CREATE INDEX source_categories_parent_idx ON source_categories(source,parent_id);
 END IF;
END $$;
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
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='product_source_categories'::regclass AND c.relname='product_source_categories_category_idx') THEN
  CREATE INDEX product_source_categories_category_idx ON product_source_categories(source,category_id,supplier_item_id);
 END IF;
END $$;
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
-- Part type -> Trodo category dictionary (#851), learned from Trodo products; sources without categories
-- (spareto, parts2world) take their categories from it by part type.
CREATE TABLE IF NOT EXISTS product_type_categories (
 type text NOT NULL, source text NOT NULL, category_id integer NOT NULL,
 support integer NOT NULL, total integer NOT NULL, learned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(type,source,category_id),
 FOREIGN KEY(source,category_id) REFERENCES source_categories(source,category_id)
);
-- parts2world article part type names (#852): TecDoc's generic article name (article-info spareInfo) per archived
-- article, mapped through product_type_categories. Local only (not in the storefront bundle); an article without a row
-- is still to be fetched. spare_info NULL = answered without a name or an article. No FK: the index command truncates
-- parts2world_articles with CASCADE.
CREATE TABLE IF NOT EXISTS parts2world_article_types (
 article_id bigint NOT NULL, link_id bigint NOT NULL,
 brand text, part_number text, spare_info text,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(article_id,link_id)
);
