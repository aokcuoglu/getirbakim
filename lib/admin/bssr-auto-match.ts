import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface BssrAutoMatchStats {
  linked: number
  insertedDnmkBsbg: number
  insertedBsbgOnly: number
}

/**
 * Auto-match BSBG products to DNMK products by normalized exact part_no.
 *
 * Strategy (idempotent, additive — does NOT clear existing mappings):
 * 1. Link bsbg into existing dnmk mapping rows where part_no matches.
 * 2. For unmatched dnmk+bsbg candidate pairs where the dnmk has no mapping,
 *    insert a new row with both sides.
 * 3. Insert bsbg-only placeholder rows for any remaining bsbg products.
 *
 * Each step uses ROW_NUMBER() for stable 1-to-1 assignment.
 */
export async function autoMatchBssrProducts(options?: {
  apply?: boolean
  onProgress?: (message: string) => void
}): Promise<BssrAutoMatchStats> {
  const apply = options?.apply ?? false
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const stats: BssrAutoMatchStats = {
    linked: 0,
    insertedDnmkBsbg: 0,
    insertedBsbgOnly: 0
  }

  // Normalized part_no expression
  const dnmkNormalized = Prisma.sql`NULLIF(UPPER(REGEXP_REPLACE(COALESCE(dp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')`
  const bsbgNormalized = Prisma.sql`NULLIF(UPPER(REGEXP_REPLACE(COALESCE(bp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')`

  // ── Step 1: Link bsbg into existing dnmk mapping rows ──────────────────────
  if (apply) {
    const linkResult = await db.$executeRaw(Prisma.sql`
      WITH already_linked_bsbg AS (
        SELECT bsbg_products_id AS id FROM v0.product_mappings WHERE bsbg_products_id IS NOT NULL
      ),
      match_candidates AS (
        SELECT
          pm.id AS mapping_id,
          bp.id AS bsbg_id,
          ROW_NUMBER() OVER (PARTITION BY bp.id ORDER BY pm.id) AS rn_bsbg,
          ROW_NUMBER() OVER (PARTITION BY pm.id ORDER BY bp.id) AS rn_mapping
        FROM v0.product_mappings pm
        JOIN v0.dnmk_products dp ON dp.id = pm.dnmk_products_id
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.bsbg_products bp
          ON bp.bsbg_brands_id = bm.bsbg_brands_id
          AND ${dnmkNormalized} = ${bsbgNormalized}
        WHERE pm.bsbg_products_id IS NULL
          AND ${dnmkNormalized} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM already_linked_bsbg l WHERE l.id = bp.id)
      ),
      stable_matches AS (
        SELECT mapping_id, bsbg_id
        FROM match_candidates
        WHERE rn_bsbg = 1 AND rn_mapping = 1
      )
      UPDATE v0.product_mappings pm
      SET bsbg_products_id = sm.bsbg_id
      FROM stable_matches sm
      WHERE pm.id = sm.mapping_id
    `)
    stats.linked = Number(linkResult)
    log(`[bssr-auto-match] Linked ${stats.linked} bsbg to existing mapping rows`)
  } else {
    log('[bssr-auto-match] DRY RUN — no changes applied')
  }

  // ── Step 2: Insert new mapping rows for dnmk+bsbg pairs where dnmk has no mapping ─
  if (apply) {
    const insertResult = await db.$executeRaw(Prisma.sql`
      WITH already_linked AS (
        SELECT bsbg_products_id AS id FROM v0.product_mappings WHERE bsbg_products_id IS NOT NULL
      ),
      dnmk_with_mapping AS (
        SELECT DISTINCT dnmk_products_id AS id FROM v0.product_mappings WHERE dnmk_products_id IS NOT NULL
      ),
      match_candidates AS (
        SELECT
          bm.brand_list_id,
          dp.id AS dnmk_products_id,
          bp.id AS bsbg_products_id,
          ROW_NUMBER() OVER (PARTITION BY bp.id ORDER BY dp.id) AS rn_bsbg,
          ROW_NUMBER() OVER (PARTITION BY dp.id ORDER BY bp.id) AS rn_dnmk
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.bsbg_products bp ON bp.bsbg_brands_id = bm.bsbg_brands_id
        WHERE ${dnmkNormalized} = ${bsbgNormalized}
          AND ${dnmkNormalized} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dnmk_with_mapping d WHERE d.id = dp.id)
          AND NOT EXISTS (SELECT 1 FROM already_linked l WHERE l.id = bp.id)
      ),
      stable_matches AS (
        SELECT brand_list_id, dnmk_products_id, bsbg_products_id
        FROM match_candidates
        WHERE rn_bsbg = 1 AND rn_dnmk = 1
      )
      INSERT INTO v0.product_mappings
        (brand_list_id, dnmk_products_id, bsbg_products_id, mapping_status)
      SELECT brand_list_id, dnmk_products_id, bsbg_products_id, 'PENDING'
      FROM stable_matches
      ON CONFLICT (bsbg_products_id) WHERE bsbg_products_id IS NOT NULL
      DO UPDATE SET
        brand_list_id = EXCLUDED.brand_list_id,
        dnmk_products_id = EXCLUDED.dnmk_products_id,
        mapping_status = 'PENDING'
    `)
    stats.insertedDnmkBsbg = Number(insertResult)
    log(`[bssr-auto-match] Inserted ${stats.insertedDnmkBsbg} dnmk+bsbg mapping rows`)
  }

  // ── Step 3: Insert bsbg-only placeholder rows ──────────────────────────────
  if (apply) {
    const bsbgOnlyResult = await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.product_mappings
        (brand_list_id, bsbg_products_id, mapping_status)
      SELECT
        bm.brand_list_id,
        bp.id,
        'PENDING'
      FROM v0.bsbg_products bp
      JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.product_mappings pm WHERE pm.bsbg_products_id = bp.id
      )
      ON CONFLICT (bsbg_products_id) WHERE bsbg_products_id IS NOT NULL
      DO NOTHING
    `)
    stats.insertedBsbgOnly = Number(bsbgOnlyResult)
    log(`[bssr-auto-match] Inserted ${stats.insertedBsbgOnly} bsbg-only placeholder rows`)
  }

  return stats
}
