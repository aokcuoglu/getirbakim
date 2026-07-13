import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql, SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from './catalog-sql'

export interface MatchSupplierStats {
  productsCreated: number
  offersLinked: number
  offersLinkedByOem: number
  namesUpgraded: number
}

const dnmkKey = normCodeSql(Prisma.sql`COALESCE(dp.part_no, dp.stock_code)`)
const bsbgKey = normCodeSql(Prisma.sql`COALESCE(bp.part_no, bp.malzeme_no)`)

/**
 * Attach Dinamik raw rows (catalog.supplier_dinamik_products) to the canonical catalog.
 *
 * Idempotent and additive: rows that already have an offer are skipped.
 * Only rows under an APPROVED brand mapping participate. Matching key is
 * the normalized part_no (falling back to stock_code). Duplicate keys within
 * a brand keep only the first row (stable ROW_NUMBER order); the rest stay
 * unlinked and are surfaced via countUnlinkedSupplierRows().
 */
export async function matchDinamikSupplierRows(): Promise<MatchSupplierStats> {
  const stats: MatchSupplierStats = {
    productsCreated: 0,
    offersLinked: 0,
    offersLinkedByOem: 0,
    namesUpgraded: 0
  }

  stats.productsCreated = await db.$executeRaw(Prisma.sql`
    WITH candidates AS (
      SELECT
        bm.brand_id,
        COALESCE(dp.part_no, dp.stock_code) AS part_no_display,
        ${dnmkKey} AS key_norm,
        COALESCE(NULLIF(dp.stock_name, ''), dp.stock_code) AS display_name,
        NULLIF(dp.image_url, '') AS image_url,
        ROW_NUMBER() OVER (
          PARTITION BY bm.brand_id, ${dnmkKey}
          ORDER BY dp.id
        ) AS rn
      FROM catalog.supplier_dinamik_products dp
      JOIN catalog.brand_mappings bm
        ON bm.dinamik_brand_id = dp.brand_id
        AND bm.mapping_status = 'APPROVED'
      WHERE dp.is_passive = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id
        )
    )
    INSERT INTO catalog.products (brand_id, part_no, part_no_norm, name, primary_image_url)
    SELECT brand_id, part_no_display, key_norm, display_name, image_url
    FROM candidates
    WHERE rn = 1 AND key_norm IS NOT NULL
    ON CONFLICT (brand_id, part_no_norm) DO NOTHING
  `)

  // Tie-break among duplicate raw rows collapsing into one product: prefer a
  // sellable row (in stock, then cheapest) over the arbitrary oldest id, so the
  // single linked offer reflects live availability/price rather than row order.
  stats.offersLinked = await db.$executeRaw(Prisma.sql`
    WITH candidates AS (
      SELECT
        p.id AS product_id,
        dp.id AS dnmk_id,
        dp.stock_code,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY (COALESCE(dc.stock_qty, 0) > 0) DESC, dc.price ASC NULLS LAST, dp.id
        ) AS rn
      FROM catalog.supplier_dinamik_products dp
      JOIN catalog.brand_mappings bm
        ON bm.dinamik_brand_id = dp.brand_id
        AND bm.mapping_status = 'APPROVED'
      JOIN catalog.products p
        ON p.brand_id = bm.brand_id
        AND p.part_no_norm = ${dnmkKey}
      LEFT JOIN catalog.supplier_dinamik_cost dc ON dc.product_id = dp.id
      WHERE dp.is_passive = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id
        )
    )
    INSERT INTO catalog.product_offers (product_id, supplier_code, dinamik_product_id, supplier_sku)
    SELECT product_id, ${SUPPLIER_DINAMIK}, dnmk_id, stock_code
    FROM candidates
    WHERE rn = 1
    ON CONFLICT DO NOTHING
  `)

  return stats
}

async function linkBasbugOffersByKey(): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    WITH candidates AS (
      SELECT
        p.id AS product_id,
        bp.id AS bsbg_id,
        bp.malzeme_no,
        -- Başbuğ stock is uniformly 0 (not yet ingested), so cheapest list price
        -- is the meaningful tie-break among duplicate rows; id breaks true ties.
        ROW_NUMBER() OVER (
          PARTITION BY p.id ORDER BY bp.liste_fiyati ASC NULLS LAST, bp.id
        ) AS rn
      FROM catalog.supplier_basbug_products bp
      JOIN catalog.brand_mappings bm
        ON bm.basbug_brand_id = bp.brand_id
        AND bm.mapping_status = 'APPROVED'
      JOIN catalog.products p
        ON p.brand_id = bm.brand_id
        AND p.part_no_norm = ${bsbgKey}
      WHERE bp.is_passive = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id
        )
    )
    INSERT INTO catalog.product_offers (product_id, supplier_code, basbug_product_id, supplier_sku)
    SELECT product_id, ${SUPPLIER_BASBUG}, bsbg_id, malzeme_no
    FROM candidates
    WHERE rn = 1
    ON CONFLICT DO NOTHING
  `)
}

/**
 * Attach Başbuğ raw rows (catalog.supplier_basbug_products) to the canonical catalog.
 *
 * Başbuğ part_no derivation is a brittle heuristic, so the match ladder is:
 *  1. normalized part_no (falling back to malzeme_no) → existing product
 *  2. unique OEM overlap (bsbg oem_no tokens ∩ product_oems) within the brand
 *  3. create a new product from the row's own key, then link
 */
export async function matchBasbugSupplierRows(): Promise<MatchSupplierStats> {
  const stats: MatchSupplierStats = {
    productsCreated: 0,
    offersLinked: 0,
    offersLinkedByOem: 0,
    namesUpgraded: 0
  }

  stats.offersLinked = await linkBasbugOffersByKey()

  stats.offersLinkedByOem = await db.$executeRaw(Prisma.sql`
    WITH bsbg_tokens AS (
      SELECT DISTINCT
        bp.id AS bsbg_id,
        bm.brand_id,
        ${normCodeSql(Prisma.sql`tok`)} AS code_norm
      FROM catalog.supplier_basbug_products bp
      JOIN catalog.brand_mappings bm
        ON bm.basbug_brand_id = bp.brand_id
        AND bm.mapping_status = 'APPROVED'
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(bp.oem_no, ''), '[;,]| - ') AS tok
      WHERE bp.is_passive = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id
        )
        AND LENGTH(${normCodeSql(Prisma.sql`tok`)}) >= 4
    ),
    candidate_products AS (
      SELECT DISTINCT bt.bsbg_id, oe.product_id
      FROM bsbg_tokens bt
      JOIN catalog.product_oems oe ON oe.code_norm = bt.code_norm
      JOIN catalog.products p
        ON p.id = oe.product_id
        AND p.brand_id = bt.brand_id
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog.product_offers po
        WHERE po.product_id = oe.product_id AND po.supplier_code = ${SUPPLIER_BASBUG}
      )
    ),
    unique_candidates AS (
      SELECT bsbg_id, MIN(product_id) AS product_id
      FROM candidate_products
      GROUP BY bsbg_id
      HAVING COUNT(DISTINCT product_id) = 1
    ),
    stable AS (
      SELECT
        uc.bsbg_id,
        uc.product_id,
        ROW_NUMBER() OVER (
          PARTITION BY uc.product_id
          ORDER BY bp.liste_fiyati ASC NULLS LAST, uc.bsbg_id
        ) AS rn
      FROM unique_candidates uc
      JOIN catalog.supplier_basbug_products bp ON bp.id = uc.bsbg_id
    )
    INSERT INTO catalog.product_offers (product_id, supplier_code, basbug_product_id, supplier_sku)
    SELECT s.product_id, ${SUPPLIER_BASBUG}, s.bsbg_id, bp.malzeme_no
    FROM stable s
    JOIN catalog.supplier_basbug_products bp ON bp.id = s.bsbg_id
    WHERE s.rn = 1
    ON CONFLICT DO NOTHING
  `)

  stats.productsCreated = await db.$executeRaw(Prisma.sql`
    WITH candidates AS (
      SELECT
        bm.brand_id,
        COALESCE(bp.part_no, bp.malzeme_no) AS part_no_display,
        ${bsbgKey} AS key_norm,
        COALESCE(NULLIF(bp.aciklama, ''), bp.malzeme_no) AS display_name,
        ROW_NUMBER() OVER (
          PARTITION BY bm.brand_id, ${bsbgKey}
          ORDER BY bp.id
        ) AS rn
      FROM catalog.supplier_basbug_products bp
      JOIN catalog.brand_mappings bm
        ON bm.basbug_brand_id = bp.brand_id
        AND bm.mapping_status = 'APPROVED'
      WHERE bp.is_passive = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id
        )
    )
    INSERT INTO catalog.products (brand_id, part_no, part_no_norm, name)
    SELECT brand_id, part_no_display, key_norm, display_name
    FROM candidates
    WHERE rn = 1 AND key_norm IS NOT NULL
    ON CONFLICT (brand_id, part_no_norm) DO NOTHING
  `)

  // Second key pass links the offers for the products just created.
  stats.offersLinked += await linkBasbugOffersByKey()

  // Display-name policy: Başbuğ aciklama wins over the Dinamik stock_name
  // (richer Turkish descriptions). Only touches rows that actually differ,
  // so re-runs are no-ops.
  stats.namesUpgraded = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET name = bp.aciklama
    FROM catalog.product_offers po
    JOIN catalog.supplier_basbug_products bp ON bp.id = po.basbug_product_id
    WHERE po.product_id = p.id
      AND po.supplier_code = ${SUPPLIER_BASBUG}
      AND NULLIF(bp.aciklama, '') IS NOT NULL
      AND p.name IS DISTINCT FROM bp.aciklama
  `)

  return stats
}

export interface UnlinkedSupplierRows {
  dinamik: number
  basbug: number
}

/** Active raw rows under APPROVED brand mappings that still have no offer. */
export async function countUnlinkedSupplierRows(): Promise<UnlinkedSupplierRows> {
  const [row] = await db.$queryRaw<Array<{ dinamik: bigint; basbug: bigint }>>(Prisma.sql`
    SELECT
      (
        SELECT COUNT(*)
        FROM catalog.supplier_dinamik_products dp
        JOIN catalog.brand_mappings bm
          ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
        WHERE dp.is_passive = false
          AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id)
      ) AS dinamik,
      (
        SELECT COUNT(*)
        FROM catalog.supplier_basbug_products bp
        JOIN catalog.brand_mappings bm
          ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
        WHERE bp.is_passive = false
          AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id)
      ) AS basbug
  `)

  return {
    dinamik: Number(row?.dinamik ?? 0),
    basbug: Number(row?.basbug ?? 0)
  }
}