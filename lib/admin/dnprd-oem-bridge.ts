import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { splitReferenceTokens } from '@/lib/matching/code-normalization'
import { classifyRefToken } from '@/lib/matching/parcatedarik-to-parts-resolver'

export interface DnprdOemBridgeStats {
  candidates: number
  productsUpdated: number
  oemTokensWritten: number
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
    productsUpdated: 0,
    oemTokensWritten: 0,
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
  //    write OEM_MATCH tokens into dnmk_products.oem_no (comma-separated).
  //    Overwrite mode: ptdrk is source-of-truth for OEM bridge data.
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

    const oemCsv = oemTokens.join(',')
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.dnmk_products
      SET oem_no = ${oemCsv}, updated_at = NOW()
      WHERE id = ${candidate.dnmk_products_id}
    `)
    stats.productsUpdated += 1
    stats.oemTokensWritten += oemTokens.length
  }

  log(
    `[dnprd-oem-bridge] Updated ${stats.productsUpdated} dnmk products with ${stats.oemTokensWritten} OEM tokens`
  )

  return stats
}

export interface DnprdSingleOemBridgeResult {
  /** Whether a ptdrk.ref_no was available to process. */
  processed: boolean
  /** OEM tokens written into dnmk_products.oem_no (comma-separated). */
  oemTokens: string[]
  /** Final oem_no value written to dnmk_products (null if no OEM tokens). */
  oemNo: string | null
}

/**
 * Apply the OEM bridge for a single matched pair: split ptdrk.ref_no tokens,
 * keep OEM_MATCH ones, write the comma-separated list into dnmk_products.oem_no.
 *
 * Overwrite mode — ptdrk is source-of-truth. If ptdrk.ref_no yields no OEM
 * tokens, dnmk_products.oem_no is set to NULL (cleared) to keep the two in
 * sync. The caller is responsible for ensuring the pair belongs to an approved
 * brand_mappings pair before calling this.
 */
export async function populateDnmkOemForSingleProduct(input: {
  dnmkProductsId: bigint
  ptdrkProductsId: number
  apply?: boolean
}): Promise<DnprdSingleOemBridgeResult> {
  const apply = input.apply ?? false

  const rows = await db.$queryRaw<Array<{ ref_no: string | null }>>(Prisma.sql`
    SELECT p.ref_no
    FROM v0.ptdrk_products p
    WHERE p.id = ${input.ptdrkProductsId}
    LIMIT 1
  `)

  const refNo = rows[0]?.ref_no ?? null

  const oemTokens: string[] = []
  if (refNo && refNo.trim().length > 0) {
    const tokens = splitReferenceTokens(refNo)
    for (const token of tokens) {
      const matchType = classifyRefToken(token)
      if (matchType === 'OEM_MATCH') {
        oemTokens.push(token.trim().toUpperCase())
      }
    }
  }

  const oemNo = oemTokens.length > 0 ? oemTokens.join(',') : null

  if (!apply) {
    return { processed: true, oemTokens, oemNo }
  }

  await db.$executeRaw(Prisma.sql`
    UPDATE v0.dnmk_products
    SET oem_no = ${oemNo}, updated_at = NOW()
    WHERE id = ${input.dnmkProductsId}
  `)

  return { processed: true, oemTokens, oemNo }
}

export interface DpprdBulkOemBridgeStats {
  /** Rows processed (PENDING product_mappings with a ptdrk.ref_no). */
  processed: number
  /** Rows where at least one OEM token was found and written. */
  oemWritten: number
  /** Rows where ptdrk.ref_no yielded no OEM tokens (oem_no set to NULL). */
  cleared: number
}

/**
 * Bulk OEM bridge for all PENDING product_mappings rows.
 *
 * For each pending mapping, splits ptdrk_products.ref_no into tokens,
 * classifies them, and writes the OEM_MATCH tokens (comma-separated) into:
 *   - v0.dnmk_products.oem_no (overwrite)
 *   - v0.product_mappings.oem_no
 *
 * Then marks the mapping as APPROVED. Implemented as a single UPDATE with a
 * subquery so it is fast for hundreds of thousands of rows (no per-row
 * round-trips). Rows without any OEM tokens get oem_no = NULL and are still
 * APPROVED (the pair is valid; ref_no just carries no OEM data).
 *
 * If `limit` is provided, only that many rows are processed (useful for
 * incremental runs). Returns counts for reporting.
 */
export async function bulkApplyOemBridgeForPendingMappings(options?: {
  limit?: number
}): Promise<DpprdBulkOemBridgeStats> {
  const limit = options?.limit
  const limitClause = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty

  const stats: DpprdBulkOemBridgeStats = {
    processed: 0,
    oemWritten: 0,
    cleared: 0
  }

  const counts = await db.$queryRaw<
    Array<{ total: bigint; written: bigint; cleared: bigint }>
  >(Prisma.sql`
    WITH target AS (
      SELECT pm.id, pm.dnmk_products_id, p.ref_no
      FROM v0.product_mappings pm
      INNER JOIN v0.ptdrk_products p ON p.id = pm.ptdrk_products_id
      WHERE pm.mapping_status = 'PENDING'
      ${limitClause}
    ),
    oem_computed AS (
      SELECT
        t.id,
        t.dnmk_products_id,
        t.ref_no,
        (
          SELECT STRING_AGG(tok, ',')
          FROM (
            SELECT UPPER(BTRIM(part)) AS tok
            FROM unnest(string_to_array(t.ref_no, ',')) AS parts(part)
            WHERE BTRIM(part) <> ''
              -- EAN排除: 8-14 haneli纯数字 → EAN, değil
              AND part !~ '^[0-9]{8,14}$'
              -- OEM: 2+ harf + 3+ rakam + alfanumerik (normalize sonrası)
              AND UPPER(REGEXP_REPLACE(BTRIM(part), '[^A-Z0-9]', '', 'g'))
                  ~ '^[A-Z]{2,}[0-9]{3,}[A-Z0-9]*$'
              AND LENGTH(BTRIM(part)) >= 4
          ) AS t2(tok)
        ) AS oem_no
      FROM target t
    ),
    updated AS (
      UPDATE v0.dnmk_products d
      SET oem_no = oc.oem_no, updated_at = NOW()
      FROM oem_computed oc
      WHERE d.id = oc.dnmk_products_id
      RETURNING oc.id, oc.oem_no
    ),
    mapping_updated AS (
      UPDATE v0.product_mappings pm
      SET mapping_status = 'APPROVED'
      FROM updated u
      WHERE pm.id = u.id
      RETURNING u.oem_no
    )
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE oem_no IS NOT NULL)::bigint AS written,
      COUNT(*) FILTER (WHERE oem_no IS NULL)::bigint AS cleared
    FROM mapping_updated
  `)

  stats.processed = Number(counts[0]?.total ?? 0)
  stats.oemWritten = Number(counts[0]?.written ?? 0)
  stats.cleared = Number(counts[0]?.cleared ?? 0)

  return stats
}