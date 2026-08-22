-- Retire the two unsupported legacy Trodo tables without risking retained data.
DO $$
DECLARE
  has_rows boolean;
BEGIN
  -- PostgreSQL plans static SQL in this block before evaluating an AND guard.
  -- Leave the legacy schema untouched unless both expected tables are present.
  IF to_regclass('trodo.category_tree') IS NULL
     OR to_regclass('trodo.variants') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM "trodo"."category_tree")' INTO has_rows;
  IF has_rows THEN
    RAISE EXCEPTION 'Refusing to drop non-empty legacy table trodo.category_tree';
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM "trodo"."variants")' INTO has_rows;
  IF has_rows THEN
    RAISE EXCEPTION 'Refusing to drop non-empty legacy table trodo.variants';
  END IF;

  DROP TABLE IF EXISTS "trodo"."category_tree";
  DROP TABLE IF EXISTS "trodo"."variants";
  DROP SCHEMA IF EXISTS "trodo";
END
$$;
