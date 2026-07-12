import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface DpprdAutoMatchStats {
  cleared: boolean
  candidates: number
  inserted: number
}

export async function autoMatchDpprdProducts(options?: {
  apply?: boolean
  onProgress?: (message: string) => void
}): Promise<DpprdAutoMatchStats> {
  const apply = options?.apply ?? false
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const stats: DpprdAutoMatchStats = {
    cleared: false,
    candidates: 0,
    inserted: 0
  }

  // 1. Clear product_mappings
  if (apply) {
    await db.$executeRaw(Prisma.sql`TRUNCATE TABLE v0.product_mappings RESTART IDENTITY CASCADE`)
    stats.cleared = true
    log('[dpprd-auto-match] Cleared product_mappings')
  }

  // 2. Find candidate pairs: same brand_list + exact normalized part_no
  const candidates = await db.$queryRaw<
    Array<{ brand_list_id: number; dnmk_products_id: bigint; ptdrk_products_id: number }>
  >(Prisma.sql`
    SELECT DISTINCT
      bm_d.brand_list_id,
      dp.id AS dnmk_products_id,
      pp.id AS ptdrk_products_id
    FROM v0.dnmk_products dp
    JOIN v0.brand_mappings bm_d ON bm_d.dnmk_brands_id = dp.dnmk_brands_id
    JOIN v0.brand_mappings bm_p ON bm_p.brand_list_id = bm_d.brand_list_id AND bm_p.ptdrk_brands_id IS NOT NULL
    JOIN v0.ptdrk_products pp ON pp.ptdrk_brands_id = bm_p.ptdrk_brands_id
    WHERE NULLIF(UPPER(REGEXP_REPLACE(COALESCE(dp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '') IS NOT NULL
      AND NULLIF(UPPER(REGEXP_REPLACE(COALESCE(dp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
        = NULLIF(UPPER(REGEXP_REPLACE(COALESCE(pp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
  `)

  stats.candidates = candidates.length
  log(`[dpprd-auto-match] ${stats.candidates} candidate pairs`)

  if (!apply || candidates.length === 0) return stats

  // 3. Bulk insert in chunks
  const CHUNK_SIZE = 1000
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE)
    const tuples = chunk.map(
      (c) =>
        Prisma.sql`(${c.brand_list_id}, ${c.dnmk_products_id}, ${c.ptdrk_products_id}, 'PENDING')`
    )

    const result = await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.product_mappings
        (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT (dnmk_products_id, ptdrk_products_id) WHERE ptdrk_products_id IS NOT NULL DO NOTHING
    `)
    stats.inserted += Number(result)
  }

  log(`[dpprd-auto-match] Inserted ${stats.inserted} product_mappings`)

  return stats
}
