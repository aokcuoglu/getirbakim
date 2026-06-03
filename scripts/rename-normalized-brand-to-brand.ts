/**
 * Rename normalized_brand column to brand in brand_list and product_mapping tables.
 *
 * Run once:
 *   npx tsx scripts/rename-normalized-brand-to-brand.ts
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

async function main() {
  console.log('Renaming normalized_brand → brand...')

  // 1. brand_list table
  console.log('  v0.brand_list.normalized_brand → brand')
  await db.$executeRaw(Prisma.sql`
    ALTER TABLE v0.brand_list RENAME COLUMN normalized_brand TO brand
  `)

  console.log('  v0.brand_list index rename')
  await db.$executeRaw(Prisma.sql`
    ALTER INDEX v0.idx_dbrands_match_normalized_brand RENAME TO idx_dbrands_match_brand
  `)

  // 2. product_mapping table
  console.log('  v0.product_mapping.normalized_brand → brand')
  await db.$executeRaw(Prisma.sql`
    ALTER TABLE v0.product_mapping RENAME COLUMN normalized_brand TO brand
  `)

  console.log('  v0.product_mapping index rename')
  await db.$executeRaw(Prisma.sql`
    ALTER INDEX v0.idx_dpmatch_normalized_brand RENAME TO idx_dpmatch_brand
  `)

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
