import 'server-only'

import { unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type DbrandsMatchPtBrandColumn = 'ptbrands_id' | 'manufacturer_id'

/**
 * Resolves v0.dbrands_match ParçaTedarik FK column name.
 * After migration 20260525230000_v0_column_renames this is ptbrands_id;
 * legacy databases still use manufacturer_id.
 */
async function resolveDbrandsMatchPtBrandColumn(): Promise<DbrandsMatchPtBrandColumn> {
  const [row] = await db.$queryRaw<Array<{ col: string | null }>>(Prisma.sql`
    SELECT column_name AS col
    FROM information_schema.columns
    WHERE table_schema = 'v0'
      AND table_name = 'dbrands_match'
      AND column_name IN ('ptbrands_id', 'manufacturer_id')
    ORDER BY CASE column_name WHEN 'ptbrands_id' THEN 0 ELSE 1 END
    LIMIT 1
  `)
  return row?.col === 'manufacturer_id' ? 'manufacturer_id' : 'ptbrands_id'
}

const getCachedDbrandsMatchPtBrandColumn = unstable_cache(
  resolveDbrandsMatchPtBrandColumn,
  ['v0-dbrands-match-pt-brand-column'],
  { revalidate: 3600 }
)

export async function getDbrandsMatchPtBrandColumn(): Promise<DbrandsMatchPtBrandColumn> {
  return getCachedDbrandsMatchPtBrandColumn()
}
