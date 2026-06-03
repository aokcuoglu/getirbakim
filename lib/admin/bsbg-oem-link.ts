import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export function splitOemList(raw: string): string[] {
  if (!raw || !raw.trim()) return []
  return raw
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
}

export async function resolveBrandListId(opts: {
  mappingId?: number | null
  dnmkProductsId?: bigint | null
  ptdrkProductsId?: number | null
}): Promise<{ brandListId: number | null; bsbgBrandId: bigint | null }> {
  if (opts.mappingId) {
    const rows = await db.$queryRaw<Array<{ brand_list_id: number | null }>>(
      Prisma.sql`SELECT brand_list_id FROM v0.product_mapping WHERE id = ${opts.mappingId} LIMIT 1`,
    )
    if (rows[0]?.brand_list_id != null) {
      const bsbgRows = await db.$queryRaw<Array<{ bsbg_brands_id: bigint | null }>>(
        Prisma.sql`
          SELECT bsbg_brands_id FROM v0.brand_mappings
          WHERE brand_list_id = ${rows[0].brand_list_id}
            AND bsbg_brands_id IS NOT NULL
          ORDER BY CASE WHEN mapping_status = 'APPROVED' THEN 0 ELSE 1 END
          LIMIT 1
        `,
      )
      return { brandListId: rows[0].brand_list_id, bsbgBrandId: bsbgRows[0]?.bsbg_brands_id ?? null }
    }
  }

  if (opts.dnmkProductsId) {
    const rows = await db.$queryRaw<Array<{ brand_list_id: number | null; bsbg_brands_id: bigint | null }>>(
      Prisma.sql`
        SELECT bm.brand_list_id, bm.bsbg_brands_id
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        WHERE dp.id = ${opts.dnmkProductsId}
        ORDER BY CASE WHEN bm.mapping_status = 'APPROVED' THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    if (rows[0]?.brand_list_id != null) {
      return { brandListId: rows[0].brand_list_id, bsbgBrandId: rows[0].bsbg_brands_id }
    }
  }

  if (opts.ptdrkProductsId) {
    const rows = await db.$queryRaw<Array<{ brand_list_id: number | null; bsbg_brands_id: bigint | null }>>(
      Prisma.sql`
        SELECT bm.brand_list_id, bm.bsbg_brands_id
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        WHERE pp.id = ${opts.ptdrkProductsId}
        ORDER BY CASE WHEN bm.mapping_status = 'APPROVED' THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    if (rows[0]?.brand_list_id != null) {
      return { brandListId: rows[0].brand_list_id, bsbgBrandId: rows[0].bsbg_brands_id }
    }
  }

  return { brandListId: null, bsbgBrandId: null }
}

export function generateBsbgMalzemeNo(oemNo: string): string {
  const sanitized = oemNo.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 40)
  const random = Math.random().toString(16).slice(2, 8)
  return `OEM-${sanitized || 'OEM'}-${random}`
}
