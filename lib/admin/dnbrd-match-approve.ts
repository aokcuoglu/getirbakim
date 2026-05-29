import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

const PT_ONLY_PENDING_FILTER = Prisma.sql`
  dnmk_brands_id IS NULL
  AND ptdrk_brands_id IS NOT NULL
  AND mapping_status = 'PENDING'
`

/** Rows with PT manufacturer only (no Dinamik brand on record). */
export async function countPendingPtOnlyDbrandsMatch(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dnmk_ptdrk_brands
    WHERE ${PT_ONLY_PENDING_FILTER}
  `)
  return row?.count ?? 0
}

/**
 * Approve PT-only brand rows that have no Dinamik counterpart (dnmk_brands_id stays NULL).
 * Does not create or link dnbrd records.
 */
export async function approvePendingPtOnlyDbrandsMatch(): Promise<number> {
  return Number(
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.dnmk_ptdrk_brands
      SET
        mapping_status = 'APPROVED',
        match_method = COALESCE(match_method, 'MANUAL')
      WHERE ${PT_ONLY_PENDING_FILTER}
    `)
  )
}
