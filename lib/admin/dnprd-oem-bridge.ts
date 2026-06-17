import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { splitReferenceTokens } from '@/lib/matching/code-normalization'
import { classifyRefToken } from '@/lib/matching/parcatedarik-to-parts-resolver'

export interface DnprdOemBridgeStats {
  candidates: number
  oemsInserted: number
  productsProcessed: number
  brandsPaired: number
}

export async function populateDnmkOemFromPtdrk(
  options?: { apply?: boolean; limit?: number; onProgress?: (message: string) => void }
): Promise<DnprdOemBridgeStats> {
  const apply = options?.apply ?? false
  const limit = options?.limit
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const stats: DnprdOemBridgeStats = {
    candidates: 0,
    oemsInserted: 0,
    productsProcessed: 0,
    brandsPaired: 0,
  }

  // ------------------------------------------------------------------
  // 1. Count paired approved brand matches (dnmk + ptdrk same canonical)
  // ------------------------------------------------------------------
  const brandCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM v0.brand_mappings bm
    WHERE bm.dnmk_brands_id IS NOT NULL
      AND bm.ptdrk_brands_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
  `)
  stats.brandsPaired = Number(brandCount[0]?.n ?? 0)
  log(`[dnprd-oem-bridge] ${stats.brandsPaired} approved paired brand matches`)

  if (stats.brandsPaired === 0) return stats

  // ------------------------------------------------------------------
  // 2. Find dnmk+ptdrk candidate pairs via normalized part_no match
  //    under approved paired brand mappings.
  //    Does NOT require product_mapping (works directly via brand match).
  // ------------------------------------------------------------------
  const limitClause = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty

  const candidates = await db.$queryRaw<
    Array<{
      dnmk_products_id: bigint
      ref_no: string | null
    }>
  >(Prisma.sql`
    SELECT
      d.id AS dnmk_products_id,
      p.ref_no
    FROM v0.brand_mappings bm
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE bm.dnmk_brands_id IS NOT NULL
      AND bm.ptdrk_brands_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
      AND NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
        = NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
      AND p.ref_no IS NOT NULL
      AND BTRIM(p.ref_no) <> ''
    ${limitClause}
  `)

  stats.candidates = candidates.length
  log(`[dnprd-oem-bridge] ${stats.candidates} dnmk+ptdrk pairs with matching part_no`)

  if (!apply || candidates.length === 0) return stats

  // ------------------------------------------------------------------
  // 3. For each candidate, split ptdrk.ref_no tokens,
  //    classify each token (OEM/EAN/cross-ref),
  //    insert OEM_MATCH tokens into v0.dnmk_product_oems (source='PTDRK_BRIDGE').
  // ------------------------------------------------------------------
  for (const candidate of candidates) {
    const tokens = splitReferenceTokens(candidate.ref_no)
    if (tokens.length === 0) continue

    const oemTokens: string[] = []
    for (const token of tokens) {
      const matchType = classifyRefToken(token)
      if (matchType === 'OEM_MATCH') {
        oemTokens.push(token.trim().toUpperCase())
      }
    }

    if (oemTokens.length === 0) continue

    // Batch insert OEM tokens for this dnmk product
    const inserted = await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.dnmk_product_oems (dnmk_products_id, oem_no, source)
      SELECT ${candidate.dnmk_products_id}, v.oem, 'PTDRK_BRIDGE'
      FROM (VALUES ${Prisma.join(
        oemTokens.map((t) => Prisma.sql`(${t})`)
      )}) AS v(oem)
      ON CONFLICT (dnmk_products_id, oem_no) DO NOTHING
    `)
    stats.oemsInserted += Number(inserted)
    stats.productsProcessed += inserted > 0 ? 1 : 0
  }

  log(
    `[dnprd-oem-bridge] Inserted ${stats.oemsInserted} OEM tokens for ${stats.productsProcessed} dnmk products`
  )

  return stats
}