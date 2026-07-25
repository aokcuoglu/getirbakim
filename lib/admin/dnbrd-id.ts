import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

const BATCH_SIZE = 500

/**
 * Dinamik marka satırlarının var olmasını garantiler (FK öncesi).
 * ParcaTedarik kaldırılırken dnbrd-reconcile modülü silindi; bu fonksiyon
 * saf dinamik mantığı olduğu için tek tüketicisine taşındı.
 */
async function ensureDbrandsRows(brands: string[]): Promise<number> {
  const unique = Array.from(
    new Set(brands.map((b) => b.trim()).filter((b) => b.length > 0))
  )
  if (unique.length === 0) return 0

  let inserted = 0
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const values = batch.map((brand) => Prisma.sql`(${brand})`)
    const count = await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.supplier_dinamik_brands (brand)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (brand) DO NOTHING
    `)
    inserted += Number(count)
  }
  return inserted
}

function brandKey(brand: string): string {
  return brand.trim().toLowerCase()
}

/** Resolve Dinamik brand names to dnbrd.id (inserts missing rows). */
export async function resolveDbrandsIdsByBrand(
  brands: string[]
): Promise<Map<string, bigint>> {
  const unique = Array.from(
    new Set(
      brands
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
    )
  )
  if (unique.length === 0) return new Map()

  await ensureDbrandsRows(unique)

  const rows = await db.$queryRaw<Array<{ id: bigint; brand: string }>>(Prisma.sql`
    SELECT id, brand
    FROM catalog.supplier_dinamik_brands
    WHERE brand IN (${Prisma.join(unique)})
  `)

  const map = new Map<string, bigint>()
  for (const row of rows) {
    map.set(brandKey(row.brand), row.id)
  }
  return map
}

export async function resolveDbrandsIdByBrand(brand: string): Promise<bigint | null> {
  const trimmed = brand.trim()
  if (!trimmed) return null
  const map = await resolveDbrandsIdsByBrand([trimmed])
  return map.get(brandKey(trimmed)) ?? null
}
