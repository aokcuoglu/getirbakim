/**
 * Fix trigger function on v0.brand_list that still references the old
 * column name normalized_brand (renamed to brand).
 *
 * Old function: v0.enforce_uppercase_normalized_brand()
 *   references NEW.normalized_brand  →  ERROR
 *
 * New function: v0.enforce_uppercase_brand()
 *   references NEW.brand             →  OK
 *
 * Run once after rename-normalized-brand-to-brand.ts:
 *   npx tsx scripts/fix-brand_list-trigger-normalized_brand.ts
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

async function main() {
  console.log('Fixing brand_list trigger (normalized_brand → brand)...')

  // 1. Drop the old trigger
  console.log('  Dropping old trigger trg_enforce_uppercase_normalized_brand...')
  await db.$executeRaw(Prisma.sql`
    DROP TRIGGER IF EXISTS trg_enforce_uppercase_normalized_brand ON v0.brand_list
  `)

  // 2. Drop the old function (CASCADE not needed since trigger is already dropped)
  console.log('  Dropping old function v0.enforce_uppercase_normalized_brand()...')
  await db.$executeRaw(Prisma.sql`
    DROP FUNCTION IF EXISTS v0.enforce_uppercase_normalized_brand()
  `)

  // 3. Create the new function referencing NEW.brand
  console.log('  Creating new function v0.enforce_uppercase_brand()...')
  await db.$executeRaw(Prisma.sql`
    CREATE OR REPLACE FUNCTION v0.enforce_uppercase_brand()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      NEW.brand = UPPER(BTRIM(NEW.brand));
      RETURN NEW;
    END;
    $function$
  `)

  // 4. Create the new trigger
  console.log('  Creating new trigger trg_enforce_uppercase_brand...')
  await db.$executeRaw(Prisma.sql`
    CREATE TRIGGER trg_enforce_uppercase_brand
    BEFORE INSERT OR UPDATE ON v0.brand_list
    FOR EACH ROW
    EXECUTE FUNCTION v0.enforce_uppercase_brand()
  `)

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
