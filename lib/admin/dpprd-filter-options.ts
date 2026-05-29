import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type AdminDpmatchFilterOptions = {
  dinamikBrands: string[]
  manufacturers: Array<{ id: number; name: string }>
}

export async function getDpmatchFilterOptions(): Promise<AdminDpmatchFilterOptions> {
  const [brandRows, manufacturerRows] = await Promise.all([
    db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
      SELECT DISTINCT BTRIM(d.brand) AS brand
      FROM v0.dnmk_ptdrk_brands a
      INNER JOIN v0.dnmk_brands d ON d.id = a.dnmk_brands_id
      WHERE d.brand IS NOT NULL AND BTRIM(d.brand) <> ''
      ORDER BY brand ASC
    `),
    db.$queryRaw<Array<{ id: number; name: string }>>(Prisma.sql`
      SELECT DISTINCT m.id, m.name
      FROM v0.dnmk_ptdrk_brands a
      INNER JOIN v0.ptdrk_brands m ON m.id = a.ptdrk_brands_id
      WHERE m.name IS NOT NULL AND BTRIM(m.name) <> ''
      ORDER BY m.name ASC
    `)
  ])

  return {
    dinamikBrands: brandRows.map((row) => row.brand),
    manufacturers: manufacturerRows
  }
}
