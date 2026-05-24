import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type DinamikBrandMatchStats = {
  totalDinamikBrands: number
  matchedBrands: number
  unmatchedBrands: number
  totalPcManufacturers: number
}

/**
 * Counts Dinamik catalog brands from dproducts and how many have an active
 * (PENDING/APPROVED) row in dbrands_match. Both sides use the same source
 * so matched + unmatched always equals totalDinamikBrands.
 */
export async function getDinamikBrandMatchStats(): Promise<DinamikBrandMatchStats> {
  const brandFilter = Prisma.sql`d.brand IS NOT NULL AND BTRIM(d.brand) <> ''`
  const activeMatch = Prisma.sql`
    BTRIM(LOWER(a.dbrands_id)) = BTRIM(LOWER(d.brand))
    AND a.mapping_status IN ('PENDING', 'APPROVED')
  `

  const [totalDinamikBrands, matchedDinamikBrands, unmatchedDinamikBrands, totalPcManufacturers] =
    await Promise.all([
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT d.brand) AS count
        FROM parcatedarik.dproducts d
        WHERE ${brandFilter}
      `),
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT d.brand) AS count
        FROM parcatedarik.dproducts d
        WHERE ${brandFilter}
          AND EXISTS (
            SELECT 1
            FROM parcatedarik.dbrands_match a
            WHERE ${activeMatch}
          )
      `),
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT d.brand) AS count
        FROM parcatedarik.dproducts d
        WHERE ${brandFilter}
          AND NOT EXISTS (
            SELECT 1
            FROM parcatedarik.dbrands_match a
            WHERE ${activeMatch}
          )
      `),
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count FROM parcatedarik.manufacturer
      `),
    ])

  return {
    totalDinamikBrands: Number(totalDinamikBrands[0]?.count ?? 0),
    matchedBrands: Number(matchedDinamikBrands[0]?.count ?? 0),
    unmatchedBrands: Number(unmatchedDinamikBrands[0]?.count ?? 0),
    totalPcManufacturers: Number(totalPcManufacturers[0]?.count ?? 0),
  }
}
