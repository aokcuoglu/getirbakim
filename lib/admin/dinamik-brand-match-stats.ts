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
  const activeMatch = Prisma.sql`
    m.mapping_status IN ('PENDING', 'APPROVED')
    AND m.ptdrk_brand_id IS NOT NULL
  `

  const [row] = await db.$queryRaw<
    Array<{
      total_dinamik_brands: number
      matched_brands: number
      total_pc_manufacturers: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM catalog.supplier_dinamik_brands) AS total_dinamik_brands,
      (
        SELECT COUNT(*)::int
        FROM catalog.supplier_dinamik_brands d
        WHERE EXISTS (
          SELECT 1
          FROM catalog.brand_mappings m
          WHERE m.dinamik_brand_id = d.id
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
