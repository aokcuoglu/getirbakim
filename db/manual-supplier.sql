-- Manual supplier lists: an admin uploads an xlsx in the fixed template (src/modules/suppliers/manual-template.ts) and
-- each list is imported like an API snapshot into supplier_items (supplier='manual', company='MANUEL', list_group=slug).
-- An upload is parsed and validated first; it changes nothing until an admin confirms the draft.
CREATE TABLE IF NOT EXISTS manual_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 list_group text NOT NULL CHECK (list_group ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(list_group)<=60),
 list_name text NOT NULL CHECK (length(list_name) BETWEEN 1 AND 120),
 file_name text NOT NULL, rows jsonb NOT NULL CHECK (jsonb_typeof(rows)='array'), report jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','imported','discarded')),
 import_id uuid REFERENCES supplier_imports(id) ON DELETE SET NULL,
 uploaded_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS manual_uploads_list_idx ON manual_uploads(list_group,created_at DESC);
-- Values an admin entered on the item page. A filled cell in a later upload wins; these fill only the cells it leaves
-- empty, so a re-upload of the same file keeps them. Keyed by list and code: the item row may be recreated.
CREATE TABLE IF NOT EXISTS manual_item_overrides (
 list_group text NOT NULL, code text NOT NULL,
 fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='object'),
 updated_by uuid REFERENCES accounts(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (list_group,code)
);
