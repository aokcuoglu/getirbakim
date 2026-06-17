import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface DnbsbgMatchStats {
  // Diagnostic counts
  pairedBrands: number
  dnmkProducts: number
  bsbgProducts: number
  dnmkUnpaired: number
  bsbgUnpaired: number
  // Match counts
  partNoMatchCandidates: number
  partNoMatchLinked: number
  oemBridgeSameMatchCandidates: number
  oemBridgeSameLinked: number
  oemBridgeCrossRefs: number
  // Single-side auto-approve
  dnmkOnlyApproved: number
  bsbgOnlyApproved: number
  // Placeholders
  dnmkPending: number
  bsbgPending: number
}

export function createEmptyDnbsbgMatchStats(): DnbsbgMatchStats {
  return {
    pairedBrands: 0,
    dnmkProducts: 0,
    bsbgProducts: 0,
    dnmkUnpaired: 0,
    bsbgUnpaired: 0,
    partNoMatchCandidates: 0,
    partNoMatchLinked: 0,
    oemBridgeSameMatchCandidates: 0,
    oemBridgeSameLinked: 0,
    oemBridgeCrossRefs: 0,
    dnmkOnlyApproved: 0,
    bsbgOnlyApproved: 0,
    dnmkPending: 0,
    bsbgPending: 0,
  }
}

const DNMK_PART_NO_NORM = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`
const BSBG_PART_NO_NORM = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(b.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`

/** Paired brand match filter: dnmk + bsbg both linked, APPROVED, same canonical. */
const PAIRED_DNBSBG_BRAND_FILTER = Prisma.sql`
  bm.dnmk_brands_id IS NOT NULL
  AND bm.bsbg_brands_id IS NOT NULL
  AND bm.mapping_status = 'APPROVED'
`

/** dnmk only (no paired bsbg). */
const DNMK_ONLY_BRAND_FILTER = Prisma.sql`
  d.dnmk_brands_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM v0.brand_mappings bm
    WHERE bm.dnmk_brands_id = d.dnmk_brands_id
      AND bm.bsbg_brands_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
  )
`

/** bsbg only (no paired dnmk). */
const BSBG_ONLY_BRAND_FILTER = Prisma.sql`
  b.bsbg_brands_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM v0.brand_mappings bm
    WHERE bm.bsbg_brands_id = b.bsbg_brands_id
      AND bm.dnmk_brands_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
  )
`

export async function populateDnmkBsbgMatches(
  options?: { apply?: boolean; onProgress?: (message: string) => void }
): Promise<DnbsbgMatchStats> {
  const apply = options?.apply ?? false
  const log = options?.onProgress ?? ((message: string) => console.log(message))
  const stats = createEmptyDnbsbgMatchStats()

  // ------------------------------------------------------------------
  // 1. Diagnostics
  // ------------------------------------------------------------------
  const pairedBrands = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM v0.brand_mappings bm WHERE ${PAIRED_DNBSBG_BRAND_FILTER}
  `)
  stats.pairedBrands = Number(pairedBrands[0]?.n ?? 0)
  log(`[dnbsbg-match] ${stats.pairedBrands} paired approved dnmk+bsbg brand matches`)

  const dnmkProductsCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM v0.dnmk_products d WHERE d.is_passive IS DISTINCT FROM TRUE
  `)
  stats.dnmkProducts = Number(dnmkProductsCount[0]?.n ?? 0)

  const bsbgProductsCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM v0.bsbg_products b WHERE b.is_passive IS DISTINCT FROM TRUE
  `)
  stats.bsbgProducts = Number(bsbgProductsCount[0]?.n ?? 0)

  const dnmkUnpairedCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM v0.dnmk_products d
    WHERE d.is_passive IS DISTINCT FROM TRUE
      AND ${DNMK_ONLY_BRAND_FILTER}
  `)
  stats.dnmkUnpaired = Number(dnmkUnpairedCount[0]?.n ?? 0)

  const bsbgUnpairedCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM v0.bsbg_products b
    WHERE b.is_passive IS DISTINCT FROM TRUE
      AND ${BSBG_ONLY_BRAND_FILTER}
  `)
  stats.bsbgUnpaired = Number(bsbgUnpairedCount[0]?.n ?? 0)

  log(
    `[dnbsbg-match] dnmk: ${stats.dnmkProducts} products (${stats.dnmkUnpaired} unpaired brand); bsbg: ${stats.bsbgProducts} products (${stats.bsbgUnpaired} unpaired brand)`
  )

  if (!apply) return stats

  // ------------------------------------------------------------------
  // 2. Yol 1: part_no exact match (marka eşleşmiş olmalı)
  //    Stable bipartite (ROW_NUMBER): her dnmk en fazla 1 bsbg, her bsbg en fazla 1 dnmk.
  // ------------------------------------------------------------------
  const partNoCandidates = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    WITH pairs AS (
      SELECT d.id AS dnmk_id, b.id AS bsbg_id
      FROM v0.brand_mappings bm
      INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
      INNER JOIN v0.bsbg_products b ON b.bsbg_brands_id = bm.bsbg_brands_id
      WHERE ${PAIRED_DNBSBG_BRAND_FILTER}
        AND d.is_passive IS DISTINCT FROM TRUE
        AND b.is_passive IS DISTINCT FROM TRUE
        AND ${DNMK_PART_NO_NORM} IS NOT NULL
        AND ${DNMK_PART_NO_NORM} = ${BSBG_PART_NO_NORM}
    )
    SELECT COUNT(*)::bigint AS n FROM pairs
  `)
  stats.partNoMatchCandidates = Number(partNoCandidates[0]?.n ?? 0)
  log(`[dnbsbg-match] Yol 1 (part_no): ${stats.partNoMatchCandidates} candidates`)

  if (stats.partNoMatchCandidates > 0) {
    // Ensure bsbg unique partial index exists (from populate-bsbg-product-mapping script)
    await db.$executeRaw(Prisma.sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_bsbg
      ON v0.product_mapping USING btree (bsbg_products_id)
      WHERE bsbg_products_id IS NOT NULL
    `)

    // First: insert dnmk-only placeholders for dnmk products that have no mapping yet
    const dnmkPlaceholderInserted = await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.product_mapping (dnmk_products_id, ptdrk_products_id, mapping_status, part_no)
      SELECT
        d.id, NULL, 'PENDING', ${DNMK_PART_NO_NORM}
      FROM v0.brand_mappings bm
      INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
      WHERE ${PAIRED_DNBSBG_BRAND_FILTER}
        AND d.is_passive IS DISTINCT FROM TRUE
        AND NOT EXISTS (SELECT 1 FROM v0.product_mapping m WHERE m.dnmk_products_id = d.id)
      ON CONFLICT (dnmk_products_id) WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO NOTHING
    `)
    stats.dnmkPending = Number(dnmkPlaceholderInserted)

    // Link bsbg → existing dnmk mapping rows via stable bipartite match
    const linked = await db.$executeRaw(Prisma.sql`
      WITH already_linked_bsbg AS (
        SELECT bsbg_products_id AS id FROM v0.product_mapping WHERE bsbg_products_id IS NOT NULL
      ),
      match_candidates AS (
        SELECT
          m.id AS mapping_id,
          b.id AS bsbg_id,
          ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY m.id) AS rn_bsbg,
          ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY b.id) AS rn_mapping
        FROM v0.product_mapping m
        JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
        JOIN v0.bsbg_products b
          ON ${DNMK_PART_NO_NORM} = ${BSBG_PART_NO_NORM}
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = d.dnmk_brands_id AND bm.bsbg_brands_id = b.bsbg_brands_id
        WHERE m.bsbg_products_id IS NULL
          AND m.dnmk_products_id IS NOT NULL
          AND ${DNMK_PART_NO_NORM} IS NOT NULL
          AND ${PAIRED_DNBSBG_BRAND_FILTER}
          AND b.is_passive IS DISTINCT FROM TRUE
          AND NOT EXISTS (SELECT 1 FROM already_linked_bsbg l WHERE l.id = b.id)
      ),
      stable_matches AS (
        SELECT mapping_id, bsbg_id
        FROM match_candidates
        WHERE rn_bsbg = 1 AND rn_mapping = 1
      )
      UPDATE v0.product_mapping m
      SET
        bsbg_products_id = sm.bsbg_id,
        mapping_status = 'APPROVED',
        match_method = COALESCE(m.match_method, 'EXACT_PART_NO'),
        part_no = COALESCE(NULLIF(BTRIM(m.part_no), ''), sm_bsbg.part_no)
      FROM stable_matches sm
      LEFT JOIN v0.bsbg_products sm_bsbg ON sm_bsbg.id = sm.bsbg_id
      WHERE m.id = sm.mapping_id
    `)
    stats.partNoMatchLinked = Number(linked)
    log(`[dnbsbg-match] Yol 1: linked ${stats.partNoMatchLinked} bsbg to existing dnmk mapping rows`)
  }

  // ------------------------------------------------------------------
  // 3. Yol 2: OEM bridge same-brand match
  //    dnmk_product_oems.oem_no = bsbg_products.oem_no OR bsbg_products_oem_no.oem_no
  //    AND brand_mappings paired (same canonical brand)
  // ------------------------------------------------------------------
  const oemSameCandidates = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    WITH dnmk_oems AS (
      SELECT DISTINCT doem.dnmk_products_id, UPPER(BTRIM(doem.oem_no)) AS oem_no
      FROM v0.dnmk_product_oems doem
    ),
    bsbg_oems AS (
      SELECT DISTINCT b.id AS bsbg_products_id, UPPER(BTRIM(COALESCE(b.oem_no, ''))) AS oem_no
      FROM v0.bsbg_products b
      WHERE b.oem_no IS NOT NULL AND BTRIM(b.oem_no) <> ''
      UNION
      SELECT DISTINCT boem.bsbg_products_id, UPPER(BTRIM(boem.oem_no)) AS oem_no
      FROM v0.bsbg_products_oem_no boem
    ),
    pairs AS (
      SELECT d.dnmk_products_id, bo.bsbg_products_id
      FROM dnmk_oems d
      JOIN bsbg_oems bo ON d.oem_no = bo.oem_no
      JOIN v0.dnmk_products dp ON dp.id = d.dnmk_products_id
      JOIN v0.bsbg_products bp ON bp.id = bo.bsbg_products_id
      JOIN v0.brand_mappings bm
        ON bm.dnmk_brands_id = dp.dnmk_brands_id
       AND bm.bsbg_brands_id = bp.bsbg_brands_id
      WHERE ${PAIRED_DNBSBG_BRAND_FILTER}
        AND dp.is_passive IS DISTINCT FROM TRUE
        AND bp.is_passive IS DISTINCT FROM TRUE
        -- Skip pairs already linked via Yol 1
        AND NOT EXISTS (
          SELECT 1 FROM v0.product_mapping m
          WHERE m.dnmk_products_id = d.dnmk_products_id
            AND m.bsbg_products_id = bo.bsbg_products_id
            AND m.mapping_status = 'APPROVED'
        )
    )
    SELECT COUNT(*)::bigint AS n FROM pairs
  `)
  stats.oemBridgeSameMatchCandidates = Number(oemSameCandidates[0]?.n ?? 0)
  log(`[dnbsbg-match] Yol 2 (OEM same-brand): ${stats.oemBridgeSameMatchCandidates} candidates`)

  if (stats.oemBridgeSameMatchCandidates > 0) {
    // Insert APPROVED pairs (only if dnmk has no bsbg linked yet)
    const linked = await db.$executeRaw(Prisma.sql`
      WITH dnmk_oems AS (
        SELECT DISTINCT doem.dnmk_products_id, UPPER(BTRIM(doem.oem_no)) AS oem_no
        FROM v0.dnmk_product_oems doem
      ),
      bsbg_oems AS (
        SELECT DISTINCT b.id AS bsbg_products_id, UPPER(BTRIM(COALESCE(b.oem_no, ''))) AS oem_no
        FROM v0.bsbg_products b
        WHERE b.oem_no IS NOT NULL AND BTRIM(b.oem_no) <> ''
        UNION
        SELECT DISTINCT boem.bsbg_products_id, UPPER(BTRIM(boem.oem_no)) AS oem_no
        FROM v0.bsbg_products_oem_no boem
      ),
      pairs AS (
        SELECT
          d.dnmk_products_id,
          bo.bsbg_products_id,
          ROW_NUMBER() OVER (PARTITION BY d.dnmk_products_id ORDER BY bo.bsbg_products_id) AS rn_dnmk,
          ROW_NUMBER() OVER (PARTITION BY bo.bsbg_products_id ORDER BY d.dnmk_products_id) AS rn_bsbg
        FROM dnmk_oems d
        JOIN bsbg_oems bo ON d.oem_no = bo.oem_no
        JOIN v0.dnmk_products dp ON dp.id = d.dnmk_products_id
        JOIN v0.bsbg_products bp ON bp.id = bo.bsbg_products_id
        JOIN v0.brand_mappings bm
          ON bm.dnmk_brands_id = dp.dnmk_brands_id
         AND bm.bsbg_brands_id = bp.bsbg_brands_id
        WHERE ${PAIRED_DNBSBG_BRAND_FILTER}
          AND dp.is_passive IS DISTINCT FROM TRUE
          AND bp.is_passive IS DISTINCT FROM TRUE
          -- Skip dnmk already linked to a bsbg (Yol 1)
          AND NOT EXISTS (
            SELECT 1 FROM v0.product_mapping m
            WHERE m.dnmk_products_id = d.dnmk_products_id
              AND m.bsbg_products_id IS NOT NULL
              AND m.mapping_status = 'APPROVED'
          )
          -- Skip bsbg already linked
          AND NOT EXISTS (
            SELECT 1 FROM v0.product_mapping m
            WHERE m.bsbg_products_id = bo.bsbg_products_id
          )
      ),
      stable AS (
        SELECT dnmk_products_id, bsbg_products_id
        FROM pairs WHERE rn_dnmk = 1 AND rn_bsbg = 1
      )
      INSERT INTO v0.product_mapping (dnmk_products_id, bsbg_products_id, mapping_status, match_method)
      SELECT s.dnmk_products_id, s.bsbg_products_id, 'APPROVED', 'OEM_BRIDGE_SAME'
      FROM stable s
      ON CONFLICT (dnmk_products_id) WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO UPDATE
        SET bsbg_products_id = EXCLUDED.bsbg_products_id,
            mapping_status = 'APPROVED',
            match_method = 'OEM_BRIDGE_SAME'
    `)
    stats.oemBridgeSameLinked = Number(linked)
    log(`[dnbsbg-match] Yol 2 (OEM same-brand): linked ${stats.oemBridgeSameLinked} pairs`)
  }

  // ------------------------------------------------------------------
  // 4. Yol 2 cross-brand: OEM eşleşmesi + farklı marka
  //    Ayrı v0.products (single-side APPROVED), aralarında products_oems cross-ref.
  //    Önce single-side approve'lar yapılmalı (5. adım), sonra cross-ref.
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 5. Single-side auto-APPROVE: dnmk-only and bsbg-only
  //    (marka brand_mappings'te tek taraflı)
  // ------------------------------------------------------------------
  const dnmkOnlyInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_mapping (dnmk_products_id, ptdrk_products_id, mapping_status, match_method, part_no)
    SELECT
      d.id, NULL, 'APPROVED', 'SINGLE_SIDE',
      ${DNMK_PART_NO_NORM}
    FROM v0.dnmk_products d
    WHERE d.is_passive IS DISTINCT FROM TRUE
      AND ${DNMK_ONLY_BRAND_FILTER}
      AND NOT EXISTS (SELECT 1 FROM v0.product_mapping m WHERE m.dnmk_products_id = d.id)
    ON CONFLICT (dnmk_products_id) WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO NOTHING
  `)
  stats.dnmkOnlyApproved = Number(dnmkOnlyInserted)
  log(`[dnbsbg-match] Single-side dnmk-only APPROVED: ${stats.dnmkOnlyApproved}`)

  const bsbgOnlyInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_mapping (bsbg_products_id, ptdrk_products_id, mapping_status, match_method, part_no)
    SELECT
      b.id, NULL, 'APPROVED', 'SINGLE_SIDE',
      ${BSBG_PART_NO_NORM}
    FROM v0.bsbg_products b
    WHERE b.is_passive IS DISTINCT FROM TRUE
      AND ${BSBG_ONLY_BRAND_FILTER}
      AND NOT EXISTS (SELECT 1 FROM v0.product_mapping m WHERE m.bsbg_products_id = b.id)
    ON CONFLICT (bsbg_products_id) WHERE bsbg_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO NOTHING
  `)
  stats.bsbgOnlyApproved = Number(bsbgOnlyInserted)
  log(`[dnbsbg-match] Single-side bsbg-only APPROVED: ${stats.bsbgOnlyApproved}`)

  // ------------------------------------------------------------------
  // 6. Yol 2 cross-brand OEM: products_oems cross-reference kayıtları
  //    Her dnmk-only ve bsbg-only mapping APPROVED olduktan sonra,
  //    aynı OEM'e sahip farklı marka çiftler için products_oems cross-ref.
  // ------------------------------------------------------------------
  const crossRefs = await db.$executeRaw(Prisma.sql`
    WITH dnmk_oems AS (
      SELECT DISTINCT doem.dnmk_products_id, UPPER(BTRIM(doem.oem_no)) AS oem_no
      FROM v0.dnmk_product_oems doem
    ),
    bsbg_oems AS (
      SELECT DISTINCT b.id AS bsbg_products_id, UPPER(BTRIM(COALESCE(b.oem_no, ''))) AS oem_no
      FROM v0.bsbg_products b
      WHERE b.oem_no IS NOT NULL AND BTRIM(b.oem_no) <> ''
      UNION
      SELECT DISTINCT boem.bsbg_products_id, UPPER(BTRIM(boem.oem_no)) AS oem_no
      FROM v0.bsbg_products_oem_no boem
    ),
    cross_pairs AS (
      SELECT
        d.dnmk_products_id,
        bo.bsbg_products_id,
        d.oem_no
      FROM dnmk_oems d
      JOIN bsbg_oems bo ON d.oem_no = bo.oem_no
      JOIN v0.dnmk_products dp ON dp.id = d.dnmk_products_id
      JOIN v0.bsbg_products bp ON bp.id = bo.bsbg_products_id
      WHERE dp.is_passive IS DISTINCT FROM TRUE
        AND bp.is_passive IS DISTINCT FROM TRUE
        -- Farklı marka (cross-brand): aynı brand_list_id'ye sahip değiller
        AND NOT EXISTS (
          SELECT 1 FROM v0.brand_mappings bm
          WHERE bm.dnmk_brands_id = dp.dnmk_brands_id
            AND bm.bsbg_brands_id = bp.bsbg_brands_id
            AND ${PAIRED_DNBSBG_BRAND_FILTER}
        )
        -- Her iki taraf da product_mapping'te olmalı (single-side APPROVED)
        AND EXISTS (SELECT 1 FROM v0.product_mapping m WHERE m.dnmk_products_id = d.dnmk_products_id AND m.mapping_status = 'APPROVED')
        AND EXISTS (SELECT 1 FROM v0.product_mapping m WHERE m.bsbg_products_id = bo.bsbg_products_id AND m.mapping_status = 'APPROVED')
    )
    INSERT INTO v0.products_oems (dnmk_products_id, bsbg_products_id, oem_no, relation_type, created_by)
    SELECT cp.dnmk_products_id, cp.bsbg_products_id, cp.oem_no, 'CROSS_REFERENCE', 'DNBSBG_OEM_BRIDGE'
    FROM cross_pairs cp
    ON CONFLICT (dnmk_products_id, bsbg_products_id, oem_no) DO NOTHING
  `)
  stats.oemBridgeCrossRefs = Number(crossRefs)
  log(`[dnbsbg-match] Yol 2 cross-brand OEM cross-refs: ${stats.oemBridgeCrossRefs}`)

  return stats
}