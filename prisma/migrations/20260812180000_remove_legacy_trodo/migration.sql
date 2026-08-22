-- Retire the two unsupported legacy Trodo tables without risking retained data.
DO $$
BEGIN
  IF to_regclass('trodo.category_tree') IS NOT NULL
     AND EXISTS (SELECT 1 FROM "trodo"."category_tree" LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop non-empty legacy table trodo.category_tree';
  END IF;

  IF to_regclass('trodo.variants') IS NOT NULL
     AND EXISTS (SELECT 1 FROM "trodo"."variants" LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop non-empty legacy table trodo.variants';
  END IF;

  DROP TABLE IF EXISTS "trodo"."category_tree";
  DROP TABLE IF EXISTS "trodo"."variants";
  DROP SCHEMA IF EXISTS "trodo";
END
$$;
