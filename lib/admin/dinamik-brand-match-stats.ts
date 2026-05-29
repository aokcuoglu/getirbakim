import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getDbrandsMatchPtBrandColumn } from '@/lib/admin/v0-dnbrd-match-schema'

export type DinamikBrandMatchStats = {
  totalDinamikBrands: number
  matchedBrands: number
  unmatchedBrands: number
  totalPcManufacturers: number
}

/**
 * Brand coverage from canonical dnbrd + dpbrd (not dnprd scans).
 */
export async function getDinamikBrandMatchStats(): Promise<DinamikBrandMatchStats> {
  const ptBrandCol = await getDbrandsMatchPtBrandColumn()
  const activeMatch = Prisma.sql`
    a.mapping_status IN ('PENDING', 'APPROVED')
    AND a.${Prisma.raw(ptBrandCol)} IS NOT NULL
  `

  const [row] = await db.$queryRaw<
    Array<{
      total_dinamik_brands: number
      matched_brands: number
      total_pc_manufacturers: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dnmk_brands) AS total_dinamik_brands,
      (
        SELECT COUNT(*)::int
        FROM v0.dnmk_brands d
        WHERE EXISTS (
          SELECT 1
          FROM v0.dnmk_ptdrk_brands a
          WHERE a.dnmk_brands_id = d.id
            AND ${activeMatch}
        )
      ) AS matched_brands,
      (SELECT COUNT(*)::int FROM v0.ptdrk_brands) AS total_pc_manufacturers
  `)

  const total = row?.total_dinamik_brands ?? 0
  const matched = row?.matched_brands ?? 0

  return {
    totalDinamikBrands: total,
    matchedBrands: matched,
    unmatchedBrands: Math.max(0, total - matched),
    totalPcManufacturers: row?.total_pc_manufacturers ?? 0
  }
}
