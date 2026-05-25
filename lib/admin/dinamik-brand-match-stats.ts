import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type DinamikBrandMatchStats = {
  totalDinamikBrands: number
  matchedBrands: number
  unmatchedBrands: number
  totalPcManufacturers: number
}

const ACTIVE_MATCH = Prisma.sql`
  a.mapping_status IN ('PENDING', 'APPROVED')
  AND a.manufacturer_id IS NOT NULL
`

/**
 * Brand coverage from canonical dbrands + dbrands_match (not dproducts scans).
 */
export async function getDinamikBrandMatchStats(): Promise<DinamikBrandMatchStats> {
  const [row] = await db.$queryRaw<
    Array<{
      total_dinamik_brands: number
      matched_brands: number
      total_pc_manufacturers: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM parcatedarik.dbrands) AS total_dinamik_brands,
      (
        SELECT COUNT(*)::int
        FROM parcatedarik.dbrands d
        WHERE EXISTS (
          SELECT 1
          FROM parcatedarik.dbrands_match a
          WHERE a.dbrands_id = d.id
            AND ${ACTIVE_MATCH}
        )
      ) AS matched_brands,
      (SELECT COUNT(*)::int FROM parcatedarik.manufacturer) AS total_pc_manufacturers
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
