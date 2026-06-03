/**
 * Add brand_list_id and brand columns to product_mapping
 * and backfill from brand_mappings via dnmk_products / ptdrk_products / bsbg_products.
 *
 * Resolution priority:
 * 1. Approved paired brand_mappings (both dnmk_brands_id and ptdrk_brands_id)
 * 2. Dinamik-side approved brand mapping
 * 3. PT-side approved brand mapping
 * 4. Basbug-side approved brand mapping
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

async function addColumnsIfMissing() {
  await db.$executeRaw(Prisma.sql`
    ALTER TABLE v0.product_mapping
    ADD COLUMN IF NOT EXISTS brand_list_id INTEGER
  `)
  await db.$executeRaw(Prisma.sql`
    ALTER TABLE v0.product_mapping
    ADD COLUMN IF NOT EXISTS brand TEXT
  `)
}

async function addIndexesIfMissing() {
  await db.$executeRaw(Prisma.sql`
    CREATE INDEX IF NOT EXISTS idx_dpmatch_brand_list
    ON v0.product_mapping USING btree (brand_list_id)
  `)
  await db.$executeRaw(Prisma.sql`
    CREATE INDEX IF NOT EXISTS idx_dpmatch_brand
    ON v0.product_mapping USING btree (brand)
    WHERE brand IS NOT NULL
  `)
}

async function backfillBrands(): Promise<number> {
  let total = 0

  // Path 1: via dnmk_products -> dnmk_brands -> brand_mappings -> brand_list
  const dnmkCount = await db.$executeRaw(Prisma.sql`
    UPDATE v0.product_mapping m
    SET
      brand_list_id = sub.brand_list_id,
      brand = sub.brand
    FROM (
      SELECT DISTINCT ON (m2.id)
        m2.id,
        bm.brand_list_id,
        cb.brand
      FROM v0.product_mapping m2
      JOIN v0.dnmk_products d ON d.id = m2.dnmk_products_id
      JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = d.dnmk_brands_id AND bm.mapping_status = 'APPROVED'
      JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
      WHERE m2.brand_list_id IS NULL
      ORDER BY m2.id
    ) sub
    WHERE m.id = sub.id
  `)
  total += Number(dnmkCount)
  console.log(`  via dnmk: ${dnmkCount} rows`)

  // Path 2: via ptdrk_products -> ptdrk_brands -> brand_mappings -> brand_list
  const ptdrkCount = await db.$executeRaw(Prisma.sql`
    UPDATE v0.product_mapping m
    SET
      brand_list_id = sub.brand_list_id,
      brand = sub.brand
    FROM (
      SELECT DISTINCT ON (m2.id)
        m2.id,
        bm.brand_list_id,
        cb.brand
      FROM v0.product_mapping m2
      JOIN v0.ptdrk_products p ON p.id = m2.ptdrk_products_id
      JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = p.ptdrk_brands_id AND bm.mapping_status = 'APPROVED'
      JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
      WHERE m2.brand_list_id IS NULL
      ORDER BY m2.id
    ) sub
    WHERE m.id = sub.id
  `)
  total += Number(ptdrkCount)
  console.log(`  via ptdrk: ${ptdrkCount} rows`)

  // Path 3: via bsbg_products -> bsbg_brands -> brand_mappings -> brand_list
  const bsbgCount = await db.$executeRaw(Prisma.sql`
    UPDATE v0.product_mapping m
    SET
      brand_list_id = sub.brand_list_id,
      brand = sub.brand
    FROM (
      SELECT DISTINCT ON (m2.id)
        m2.id,
        bm.brand_list_id,
        cb.brand
      FROM v0.product_mapping m2
      JOIN v0.bsbg_products b ON b.id = m2.bsbg_products_id
      JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = b.bsbg_brands_id AND bm.mapping_status = 'APPROVED'
      JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
      WHERE m2.brand_list_id IS NULL
      ORDER BY m2.id
    ) sub
    WHERE m.id = sub.id
  `)
  total += Number(bsbgCount)
  console.log(`  via bsbg: ${bsbgCount} rows`)

  return total
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log('=== backfill-product-mapping-brands ===')
  console.log(`Mode: ${apply ? 'LIVE' : 'DRY-RUN'}\n`)

  if (!apply) {
    // Diagnostics
    const [{ total }] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total FROM v0.product_mapping
    `)
    const [{ resolvable }] = await db.$queryRaw<Array<{ resolvable: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS resolvable
      FROM v0.product_mapping m
      LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      LEFT JOIN v0.brand_mappings bm_d ON bm_d.dnmk_brands_id = d.dnmk_brands_id AND bm_d.mapping_status = 'APPROVED'
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.brand_mappings bm_p ON bm_p.ptdrk_brands_id = p.ptdrk_brands_id AND bm_p.mapping_status = 'APPROVED'
      WHERE (bm_d.brand_list_id IS NOT NULL OR bm_p.brand_list_id IS NOT NULL)
    `)
    console.log(`  total mapping rows: ${total}`)
    console.log(`  rows with an approved brand: ${resolvable}`)
    console.log('  Run with --apply to execute.')
    return
  }

  console.log('Step 1: Add columns...')
  await addColumnsIfMissing()
  console.log('  OK\n')

  console.log('Step 2: Add indexes...')
  await addIndexesIfMissing()
  console.log('  OK\n')

  console.log('Step 3: Backfill brand_list_id and brand...')
  const updated = await backfillBrands()
  console.log(`  Updated ${updated} rows\n`)

  // Verify
  const [{ total }] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total FROM v0.product_mapping
  `)
  const [{ withBrand }] = await db.$queryRaw<Array<{ withBrand: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS "withBrand"
    FROM v0.product_mapping
    WHERE brand_list_id IS NOT NULL
  `)
  console.log('=== Verification ===')
  console.log(`  total rows: ${total}`)
  console.log(`  with brand: ${withBrand}`)
  console.log(`  without brand: ${Number(total) - Number(withBrand)}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
