import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql, SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from './catalog-sql'
import { hasNameOverrideSql } from './canonical-name-sql'
import { bestOffersSql } from './best-offer'

export interface MatchSupplierStats {
  productsCreated: number
  offersLinked: number
  offersLinkedByOem: number
  namesUpgraded: number
  /** Bu pass'te PENDING kuyruğa eklenen belirsiz (çok adaylı) eşleştirme sayısı. */
  pendingCandidates: number
}

/**
 * Eşleştirme anahtarı: ham satırı bir kanonik ürüne bağlayan normalize kod.
 * Kapsama sayımı da (getProductMatchOverview) bu ifadeyi kullanır — anahtar
 * burada değişirse sayım kendiliğinden takip etsin diye dışa açık.
 * Tablo takma adları sabit: dinamik `dp`, başbuğ `bp`.
 */
export const DINAMIK_MATCH_KEY_SQL = normCodeSql(Prisma.sql`COALESCE(dp.part_no, dp.stock_code)`)
export const BASBUG_MATCH_KEY_SQL = normCodeSql(Prisma.sql`COALESCE(bp.part_no, bp.malzeme_no)`)

const dnmkKey = DINAMIK_MATCH_KEY_SQL
const bsbgKey = BASBUG_MATCH_KEY_SQL

/**
 * Attach Dinamik raw rows (catalog.supplier_dinamik_products) to the canonical catalog.
 *
 * Idempotent and additive: rows that already have an offer are skipped.
 * Only rows under an APPROVED brand mapping participate. Matching key is
 * the normalized part_no (falling back to stock_code).
 *
 * Duplicate keys within a brand (the supplier listing one part under a second
 * stock-code family — "PSA 0209GN" / "PSA-E 0209.GN") collapse onto ONE
 * canonical product but every row still gets its own offer. Which of them
 * drives price/stock is decided at read time by the rollup (active → in stock →
 * cheapest), so a row going out of stock hands over to its sibling on the next
 * refresh instead of leaving the product stranded on a dead listing.
 */
export async function matchDinamikSupplierRows(): Promise<MatchSupplierStats> {
  const stats: MatchSupplierStats = {
    productsCreated: 0,
    offersLinked: 0,
    offersLinkedByOem: 0,
    namesUpgraded: 0,
    pendingCandidates: 0
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

  // Her ham satır kendi offer'ını alır — mükerrer anahtarlar da dahil. Aynı
  // ürün+tedarikçi altında AYNI SKU iki kez gelirse (iki dinamik markası tek
  // kanonik markaya bağlıysa mümkün) uq_offers_product_supplier_sku ilkini
  // tutar, ON CONFLICT gerisini sessizce eler.
  stats.offersLinked = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_offers (product_id, supplier_code, dinamik_product_id, supplier_sku)
    SELECT p.id, ${SUPPLIER_DINAMIK}, dp.id, dp.stock_code
    FROM catalog.supplier_dinamik_products dp
    JOIN catalog.brand_mappings bm
      ON bm.dinamik_brand_id = dp.brand_id
      AND bm.mapping_status = 'APPROVED'
    JOIN catalog.products p
      ON p.brand_id = bm.brand_id
      AND p.part_no_norm = ${dnmkKey}
    WHERE dp.is_passive = false
      AND NOT EXISTS (
        SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id
      )
    ON CONFLICT DO NOTHING
  `)

  return stats
}

/** Anahtar merdiveni: her ham satır kendi offer'ını alır (mükerrerler dahil). */
async function linkBasbugOffersByKey(): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_offers (product_id, supplier_code, basbug_product_id, supplier_sku)
    SELECT p.id, ${SUPPLIER_BASBUG}, bp.id, bp.malzeme_no
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
 *
 * Rung 1 links every matching row (a product may carry several Başbuğ offers).
 * Rung 2 deliberately does NOT: an OEM overlap is a weaker signal than a code
 * match, so it only fills a product that has no Başbuğ offer yet and takes one
 * row per product. Piling rows onto an already-served product on OEM evidence
 * alone is how unrelated parts would get merged.
 */
export async function matchBasbugSupplierRows(): Promise<MatchSupplierStats> {
  const stats: MatchSupplierStats = {
    productsCreated: 0,
    offersLinked: 0,
    offersLinkedByOem: 0,
    namesUpgraded: 0,
    pendingCandidates: 0
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

  // Rung 2b: OEM örtüşmesi birden çok ürüne denk gelen (belirsiz) satırlar —
  // rung 2a'nın sessizce düşürdükleri — otomatik bağlanmaz, PENDING kuyruğa
  // yazılır ve manuel incelemeye bırakılır. Marka onayı + OEM sinyali var ama
  // hangi kanonik ürün olduğu belirsiz.
  stats.pendingCandidates = await db.$executeRaw(Prisma.sql`
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
      SELECT DISTINCT bt.bsbg_id, oe.product_id, oe.code_norm
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
    multi AS (
      SELECT bsbg_id
      FROM candidate_products
      GROUP BY bsbg_id
      HAVING COUNT(DISTINCT product_id) > 1
    )
    INSERT INTO catalog.product_match_candidates
      (product_id, supplier_code, basbug_product_id, match_method, matched_code, confidence, status)
    SELECT DISTINCT cp.product_id, ${SUPPLIER_BASBUG}, cp.bsbg_id, 'OEM_MULTI', cp.code_norm, 0.500, 'PENDING'
    FROM candidate_products cp
    JOIN multi m ON m.bsbg_id = cp.bsbg_id
    WHERE NOT EXISTS (
      SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = cp.bsbg_id
    )
    ON CONFLICT (basbug_product_id, product_id) DO NOTHING
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
        -- Belirsiz (PENDING kuyrukta) satırlar kendi kanonik ürününü yaratmasın;
        -- manuel inceleme mevcut bir ürüne bağlayabilsin diye kuyrukta beklesin.
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_match_candidates c
          WHERE c.basbug_product_id = bp.id AND c.status = 'PENDING'
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
  // so re-runs are no-ops. Admin'in name_override girdiği ürünlere hiç
  // dokunulmaz — override zaten gösterimde kazanır, ama ham adı da
  // oynatmayıp gereksiz rollup/index churn'ünü önlüyoruz.
  // Ad kaynağı, ürünün Başbuğ tarafındaki EN İYİ offer'ı — bir üründe birden
  // çok Başbuğ offer'ı olabildiği için kaynak sabitlenmezse ad her koşuda iki
  // varyantın açıklaması arasında gidip gelir.
  stats.namesUpgraded = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET name = bp.aciklama
    FROM (${bestOffersSql(Prisma.sql`po.supplier_code = ${SUPPLIER_BASBUG}`)}) b
    JOIN catalog.supplier_basbug_products bp ON bp.id = b.basbug_product_id
    WHERE b.product_id = p.id
      AND NULLIF(bp.aciklama, '') IS NOT NULL
      AND p.name IS DISTINCT FROM bp.aciklama
      AND NOT ${hasNameOverrideSql('p')}
  `)

  // Housekeeping: herhangi bir yoldan offer kazanmış satırların artık geçersiz
  // PENDING adaylarını temizle — kuyruk yalnız gerçekten bekleyenleri göstersin
  // ve re-run'lar idempotent kalsın.
  await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.product_match_candidates c
    WHERE c.status = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = c.basbug_product_id
      )
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