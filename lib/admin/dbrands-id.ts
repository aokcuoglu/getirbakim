import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ensureDbrandsRows } from '@/lib/admin/dbrands-reconcile'

function brandKey(brand: string): string {
  return brand.trim().toLowerCase()
}

/** Resolve Dinamik brand names to dbrands.id (inserts missing rows). */
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
    FROM v0.dbrands
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
