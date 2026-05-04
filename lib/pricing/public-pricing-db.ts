import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'

type CategoryMinPriceRow = {
  category_id: number
  min_real_price: Prisma.Decimal
}

async function fetchCategoryMinRealPriceMap(
  categoryIds: number[]
): Promise<[number, string][]> {
  if (categoryIds.length === 0) return []

  const uniqueCategoryIds = Array.from(
    new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))
  )
  if (uniqueCategoryIds.length === 0) return []

  const rows = await db.$queryRaw<CategoryMinPriceRow[]>(Prisma.sql`
    SELECT
      p.category_id,
      MIN(
        CASE
          WHEN COALESCE(o.lock_price, FALSE) = TRUE
            AND o.selling_price_override IS NOT NULL
          THEN o.selling_price_override
          ELSE COALESCE(
            i.computed_selling_price_ex_vat,
            i.supplier_price,
            p.price
          )
        END
      ) AS min_real_price
    FROM parts p
    LEFT JOIN part_pricing_inventory i ON i.part_id = p.id
    LEFT JOIN part_admin_overrides o ON o.part_id = p.id
    WHERE p.category_id IN (${Prisma.join(uniqueCategoryIds)})
      AND (
        (COALESCE(o.lock_price, FALSE) = TRUE AND o.selling_price_override IS NOT NULL)
        OR COALESCE(i.computed_selling_price_ex_vat, i.supplier_price, p.price) IS NOT NULL
      )
    GROUP BY p.category_id
  `)

  return rows
    .filter((row) => row.min_real_price != null)
    .map((row) => [row.category_id, String(row.min_real_price)])
}

export async function getCategoryMinRealPriceMap(
  categoryIds: number[]
): Promise<Map<number, Prisma.Decimal>> {
  if (categoryIds.length === 0) return new Map()

  const sortedIds = [...categoryIds].sort((a, b) => a - b)
  const cacheKey = `cat-min-price-v1-${sortedIds.join(',')}`

  const cached = await getFromCache<[number, string][]>(cacheKey)
  if (cached) {
    return new Map(cached.map(([id, price]) => [id, new Prisma.Decimal(price)]))
  }

  const getCached = unstable_cache(
    () => fetchCategoryMinRealPriceMap(sortedIds),
    ['category-min-price', ...sortedIds.map(String)],
    { revalidate: 1800, tags: ['pricing'] }
  )

  const entries = await getCached()
  setCache(cacheKey, entries, 1800).catch(() => {})

  return new Map(entries.map(([id, price]) => [id, new Prisma.Decimal(price)]))
}
