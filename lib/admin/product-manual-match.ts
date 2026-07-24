import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql, SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from '@/lib/catalog/catalog-sql'
import type {
  ListManualRowsResult,
  ManualCandidatesResult,
  ManualMatchBrand,
  ManualPtdrkReference,
  ManualSimilarCandidate,
  ManualUnlinkedRow,
  ProductListSupplier,
  ProductSupplierKey
} from './product-match-shared'

/**
 * Marka-kapsamlı manuel ürün eşleştirme çalışma alanı (SERVER-only).
 *
 * Akış (marka sekmesindeki SupplierBrandMatchSheet'e paralel):
 *   kanonik marka seç → o markanın APPROVED tedarikçi eşleşmeleri altındaki
 *   OFFER'I OLMAYAN dinamik/başbuğ ham satırlarını getir → seçilen satıra
 *   pg_trgm benzerlik oranıyla sıralı aday kanonik ürünleri göster →
 *   birini seçip offer oluştur (bağla). Parçatedarik yalnız referans/benzerlik
 *   ipucu olarak görünür (offer olamaz — product_offers'ta ptdrk FK'si yok).
 *
 * Benzerlik skoru: 0.6*similarity(part_no_norm) + 0.4*similarity(name).
 */

const dnmkKey = normCodeSql(Prisma.sql`COALESCE(dp.part_no, dp.stock_code)`)
const bsbgKey = normCodeSql(Prisma.sql`COALESCE(bp.part_no, bp.malzeme_no)`)

/** BigInt id'yi güvenli parse et. */
export function parseSupplierProductId(value: unknown): bigint | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!/^\d+$/.test(s)) return null
  try {
    return BigInt(s)
  } catch {
    return null
  }
}

export function isProductSupplier(value: unknown): value is ProductSupplierKey {
  return value === 'dinamik' || value === 'basbug'
}

export function isProductListSupplier(value: unknown): value is ProductListSupplier {
  return value === 'dinamik' || value === 'basbug' || value === 'ptdrk'
}

/**
 * Marka seçicisi: APPROVED eşleşmesi olan TÜM kanonik markalar + her birinin
 * altındaki offer'ı olmayan aktif dinamik/başbuğ ham satır sayısı.
 *
 * Sayımlar tek geçişte (GROUP BY) hesaplanır; böylece tüm markalar eşleşmemiş
 * sayısına göre sıralanır (eskiden ada göre kırpılıp yalnız ilk N marka
 * görünüyordu). q verilirse marka adında ILIKE ile filtrelenir.
 */
export async function listManualMatchBrands(
  q?: string,
  limit = 1000,
  withCounts = true
): Promise<ManualMatchBrand[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null

  // Filtre için hafif yol: eşleşmemiş sayımı hesaplamaz (o tarama ~200ms sürer,
  // 1M+ offer'a karşı anti-join). Marka seçici bu bilgiye ihtiyaç duymaz.
  if (!withCounts) {
    const liteFilter = like ? Prisma.sql`AND b.brand ILIKE ${like}` : Prisma.empty
    const lite = await db.$queryRaw<Array<{ brand_id: number; brand_name: string }>>(Prisma.sql`
      SELECT b.id AS brand_id, b.brand AS brand_name
      FROM catalog.brands b
      WHERE EXISTS (
        SELECT 1 FROM catalog.brand_mappings bm
        WHERE bm.brand_id = b.id AND bm.mapping_status = 'APPROVED'
      )
      ${liteFilter}
      ORDER BY b.brand ASC
      LIMIT ${limit}
    `)
    return lite.map((r) => ({ brandId: r.brand_id, brandName: r.brand_name, unlinkedCount: 0 }))
  }

  const filter = like ? Prisma.sql`AND b.brand ILIKE ${like}` : Prisma.empty

  const rows = await db.$queryRaw<
    Array<{ brand_id: number; brand_name: string; unlinked: bigint }>
  >(Prisma.sql`
    WITH uc AS (
      SELECT bm.brand_id, COUNT(*)::bigint AS c
      FROM catalog.supplier_dinamik_products dp
      JOIN catalog.brand_mappings bm
        ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
      WHERE dp.is_passive = false
        AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id)
      GROUP BY bm.brand_id
      UNION ALL
      SELECT bm.brand_id, COUNT(*)::bigint AS c
      FROM catalog.supplier_basbug_products bp
      JOIN catalog.brand_mappings bm
        ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
      WHERE bp.is_passive = false
        AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id)
      GROUP BY bm.brand_id
    ),
    agg AS (SELECT brand_id, SUM(c)::bigint AS unlinked FROM uc GROUP BY brand_id)
    SELECT b.id AS brand_id, b.brand AS brand_name, COALESCE(a.unlinked, 0)::bigint AS unlinked
    FROM catalog.brands b
    LEFT JOIN agg a ON a.brand_id = b.id
    WHERE EXISTS (
      SELECT 1 FROM catalog.brand_mappings bm
      WHERE bm.brand_id = b.id AND bm.mapping_status = 'APPROVED'
    )
    ${filter}
    ORDER BY b.brand ASC
    LIMIT ${limit}
  `)

  return rows.map((r) => ({
    brandId: r.brand_id,
    brandName: r.brand_name,
    unlinkedCount: Number(r.unlinked)
  }))
}

/**
 * Bir markanın altındaki, offer'ı olmayan aktif dinamik+başbuğ ham satırları
 * (manuel eşleştirmede kaynak). q ile SKU/ad/part_no/OEM'de arama.
 */
export async function listUnlinkedRowsForBrand(input: {
  brandId: number
  supplier?: ProductSupplierKey
  q?: string
  page?: number
  limit?: number
}): Promise<ListManualRowsResult> {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const offset = (page - 1) * limit
  const brandId = input.brandId
  const like = input.q?.trim() ? `%${input.q.trim()}%` : null

  const dnmkFilter = like
    ? Prisma.sql`AND (dp.stock_code ILIKE ${like} OR dp.stock_name ILIKE ${like} OR dp.part_no ILIKE ${like} OR dp.oem_no ILIKE ${like})`
    : Prisma.empty
  const bsbgFilter = like
    ? Prisma.sql`AND (bp.malzeme_no ILIKE ${like} OR bp.aciklama ILIKE ${like} OR bp.part_no ILIKE ${like} OR bp.oem_no ILIKE ${like})`
    : Prisma.empty

  const includeDnmk = !input.supplier || input.supplier === 'dinamik'
  const includeBsbg = !input.supplier || input.supplier === 'basbug'

  const dnmkSelect = Prisma.sql`
    SELECT 'dinamik' AS supplier, dp.id AS supplier_product_id,
      dp.stock_code AS sku, dp.stock_name AS name, dp.part_no AS part_no, dp.oem_no AS oem
    FROM catalog.supplier_dinamik_products dp
    JOIN catalog.brand_mappings bm
      ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
    WHERE bm.brand_id = ${brandId} AND dp.is_passive = false
      AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id)
      ${dnmkFilter}
  `
  const bsbgSelect = Prisma.sql`
    SELECT 'basbug' AS supplier, bp.id AS supplier_product_id,
      bp.malzeme_no AS sku, bp.aciklama AS name, bp.part_no AS part_no, bp.oem_no AS oem
    FROM catalog.supplier_basbug_products bp
    JOIN catalog.brand_mappings bm
      ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
    WHERE bm.brand_id = ${brandId} AND bp.is_passive = false
      AND NOT EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id)
      ${bsbgFilter}
  `

  const union =
    includeDnmk && includeBsbg
      ? Prisma.sql`${dnmkSelect} UNION ALL ${bsbgSelect}`
      : includeDnmk
        ? dnmkSelect
        : bsbgSelect

  const [totalRow] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total FROM (${union}) t
  `)
  const total = Number(totalRow?.total ?? 0)

  const rows = await db.$queryRaw<
    Array<{
      supplier: ProductSupplierKey
      supplier_product_id: bigint
      sku: string
      name: string | null
      part_no: string | null
      oem: string | null
    }>
  >(Prisma.sql`
    SELECT * FROM (${union}) t
    ORDER BY t.name NULLS LAST, t.supplier_product_id
    LIMIT ${limit} OFFSET ${offset}
  `)

  return {
    rows: rows.map((r) => ({
      supplier: r.supplier,
      supplierProductId: r.supplier_product_id.toString(),
      supplierSku: r.sku,
      name: r.name,
      partNo: r.part_no,
      oem: r.oem
    })),
    total,
    page,
    limit
  }
}

const ptdrkKey = normCodeSql(Prisma.sql`pp.part_no`)

/** Seçilen ham satırın adı + normalize anahtarı (benzerlik kaynağı). */
async function loadSourceNameKey(
  supplier: ProductListSupplier,
  supplierProductId: bigint
): Promise<{ name: string; key: string | null; brandId: number } | null> {
  if (supplier === SUPPLIER_DINAMIK) {
    const [row] = await db.$queryRaw<
      Array<{ s_name: string | null; s_key: string | null; brand_id: number }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF(dp.stock_name, ''), dp.stock_code) AS s_name,
             ${dnmkKey} AS s_key, bm.brand_id
      FROM catalog.supplier_dinamik_products dp
      JOIN catalog.brand_mappings bm
        ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
      WHERE dp.id = ${supplierProductId}
      LIMIT 1
    `)
    if (!row) return null
    return { name: row.s_name ?? '', key: row.s_key, brandId: row.brand_id }
  }
  if (supplier === 'ptdrk') {
    const [row] = await db.$queryRaw<
      Array<{ s_name: string | null; s_key: string | null; brand_id: number }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF(pp.title, ''), pp.sku, pp.product_id) AS s_name,
             ${ptdrkKey} AS s_key, bm.brand_id
      FROM catalog.ptdrk_products pp
      JOIN catalog.brand_mappings bm
        ON bm.ptdrk_brand_id = pp.ptdrk_brands_id AND bm.mapping_status = 'APPROVED'
      WHERE pp.id = ${supplierProductId}
      LIMIT 1
    `)
    if (!row) return null
    return { name: row.s_name ?? '', key: row.s_key, brandId: row.brand_id }
  }
  const [row] = await db.$queryRaw<
    Array<{ s_name: string | null; s_key: string | null; brand_id: number }>
  >(Prisma.sql`
    SELECT COALESCE(NULLIF(bp.aciklama, ''), bp.malzeme_no) AS s_name,
           ${bsbgKey} AS s_key, bm.brand_id
    FROM catalog.supplier_basbug_products bp
    JOIN catalog.brand_mappings bm
      ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
    WHERE bp.id = ${supplierProductId}
    LIMIT 1
  `)
  if (!row) return null
  return { name: row.s_name ?? '', key: row.s_key, brandId: row.brand_id }
}

const SIM_SCORE = (sKey: string | null, sName: string) => Prisma.sql`
  (
    COALESCE(similarity(p.part_no_norm, ${sKey ?? ''}), 0) * 0.6 +
    COALESCE(similarity(p.name, ${sName}), 0) * 0.4
  )
`

/**
 * Bir kaynak ham satıra pg_trgm benzerlik oranıyla sıralı aday kanonik ürünler
 * (aynı marka, bu tedarikçiden offer'ı olmayanlar) + Parçatedarik referansları.
 */
export async function searchSimilarCandidates(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
  limit?: number
}): Promise<ManualCandidatesResult> {
  const limit = Math.min(Math.max(1, input.limit ?? 20), 50)
  const src = await loadSourceNameKey(input.supplier, input.supplierProductId)
  if (!src) return { candidates: [], ptdrkReferences: [] }

  const score = SIM_SCORE(src.key, src.name)

  const candRows = await db.$queryRaw<
    Array<{
      id: bigint
      name: string
      part_no: string
      score: number
      has_dnmk: boolean
      has_bsbg: boolean
    }>
  >(Prisma.sql`
    SELECT p.id, p.name, p.part_no, ${score} AS score,
      EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.product_id = p.id AND po.supplier_code = 'dinamik') AS has_dnmk,
      EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.product_id = p.id AND po.supplier_code = 'basbug') AS has_bsbg
    FROM catalog.products p
    WHERE p.brand_id = ${src.brandId}
      AND NOT EXISTS (
        SELECT 1 FROM catalog.product_offers po
        WHERE po.product_id = p.id AND po.supplier_code = ${input.supplier}
      )
      AND ${score} > 0
    ORDER BY score DESC, p.id
    LIMIT ${limit}
  `)

  const candidates: ManualSimilarCandidate[] = candRows.map((r) => {
    const existingSuppliers: ProductSupplierKey[] = []
    if (r.has_dnmk) existingSuppliers.push('dinamik')
    if (r.has_bsbg) existingSuppliers.push('basbug')
    return {
      productId: r.id.toString(),
      name: r.name,
      partNo: r.part_no,
      similarity: Number(r.score),
      existingSuppliers
    }
  })

  // Kaynak zaten Parçatedarik ise ptdrk referansları gösterilmez.
  const ptdrkRows =
    input.supplier === 'ptdrk'
      ? []
      : await db.$queryRaw<
          Array<{
            id: number
            title: string
            part_no: string | null
            ref_no: string | null
            price_actual: Prisma.Decimal | null
            url: string
            score: number
          }>
        >(Prisma.sql`
          SELECT pp.id, pp.title, pp.part_no, pp.ref_no, pp.price_actual, pp.url,
            COALESCE(similarity(pp.title, ${src.name}), 0) AS score
          FROM catalog.ptdrk_products pp
          JOIN catalog.brand_mappings bm
            ON bm.ptdrk_brand_id = pp.ptdrk_brands_id AND bm.mapping_status = 'APPROVED'
          WHERE bm.brand_id = ${src.brandId}
            AND COALESCE(similarity(pp.title, ${src.name}), 0) > 0
          ORDER BY score DESC, pp.id
          LIMIT 5
        `)

  const ptdrkReferences: ManualPtdrkReference[] = ptdrkRows.map((r) => ({
    ptdrkProductId: r.id.toString(),
    title: r.title,
    partNo: r.part_no,
    refNo: r.ref_no,
    priceActual: r.price_actual == null ? null : Number(r.price_actual),
    url: r.url,
    similarity: Number(r.score)
  }))

  return { candidates, ptdrkReferences }
}

export type ManualLinkResult =
  | { ok: true; productId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'BRAND_MISMATCH' | 'ALREADY_LINKED' | 'SUPPLIER_CONFLICT' }

/**
 * Bir bağlanmamış tedarikçi satırını seçilen kanonik ürüne offer olarak bağlar.
 * Aynı marka doğrulanır; benzerlik oranı confidence olarak APPROVED bir audit
 * kaydına yazılır; o satırın bekleyen kardeş adayları REJECTED yapılır.
 */
export async function manualLinkSupplierRow(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
  productId: bigint
  reviewedBy: string | null
}): Promise<ManualLinkResult> {
  const { supplier, supplierProductId, productId, reviewedBy } = input

  // Parçatedarik: offer DEĞİL — referans kaydı (product_ptdrk_refs).
  if (supplier === 'ptdrk') {
    return db.$transaction(async (tx) => {
      const [src] = await tx.$queryRaw<Array<{ brand_id: number }>>(Prisma.sql`
        SELECT bm.brand_id
        FROM catalog.ptdrk_products pp
        JOIN catalog.brand_mappings bm
          ON bm.ptdrk_brand_id = pp.ptdrk_brands_id AND bm.mapping_status = 'APPROVED'
        WHERE pp.id = ${supplierProductId}
        LIMIT 1
      `)
      if (!src) return { ok: false as const, reason: 'NOT_FOUND' as const }

      const [prod] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT id FROM catalog.products WHERE id = ${productId} AND brand_id = ${src.brand_id} LIMIT 1
      `)
      if (!prod) return { ok: false as const, reason: 'BRAND_MISMATCH' as const }

      const [linked] = await tx.$queryRaw<Array<{ one: number }>>(Prisma.sql`
        SELECT 1 AS one FROM catalog.product_ptdrk_refs WHERE ptdrk_product_id = ${supplierProductId} LIMIT 1
      `)
      if (linked) return { ok: false as const, reason: 'ALREADY_LINKED' as const }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO catalog.product_ptdrk_refs (product_id, ptdrk_product_id, matched_code, confidence, created_by)
        SELECT ${productId}, ${supplierProductId}, ${ptdrkKey},
          (COALESCE(similarity(p.part_no_norm, ${ptdrkKey}), 0) * 0.6 + COALESCE(similarity(p.name, COALESCE(NULLIF(pp.title,''), pp.sku, pp.product_id)), 0) * 0.4),
          ${reviewedBy}
        FROM catalog.products p
        JOIN catalog.ptdrk_products pp ON pp.id = ${supplierProductId}
        WHERE p.id = ${productId}
        ON CONFLICT (ptdrk_product_id) DO NOTHING
      `)

      return { ok: true as const, productId: productId.toString() }
    })
  }

  return db.$transaction(async (tx) => {
    const src = await (async () => {
      if (supplier === SUPPLIER_DINAMIK) {
        const [r] = await tx.$queryRaw<
          Array<{ brand_id: number; sku: string; s_name: string | null; s_key: string | null }>
        >(Prisma.sql`
          SELECT bm.brand_id, dp.stock_code AS sku,
                 COALESCE(NULLIF(dp.stock_name, ''), dp.stock_code) AS s_name, ${dnmkKey} AS s_key
          FROM catalog.supplier_dinamik_products dp
          JOIN catalog.brand_mappings bm
            ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
          WHERE dp.id = ${supplierProductId} AND dp.is_passive = false
          LIMIT 1
        `)
        return r
      }
      const [r] = await tx.$queryRaw<
        Array<{ brand_id: number; sku: string; s_name: string | null; s_key: string | null }>
      >(Prisma.sql`
        SELECT bm.brand_id, bp.malzeme_no AS sku,
               COALESCE(NULLIF(bp.aciklama, ''), bp.malzeme_no) AS s_name, ${bsbgKey} AS s_key
        FROM catalog.supplier_basbug_products bp
        JOIN catalog.brand_mappings bm
          ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
        WHERE bp.id = ${supplierProductId} AND bp.is_passive = false
        LIMIT 1
      `)
      return r
    })()

    if (!src) return { ok: false as const, reason: 'NOT_FOUND' as const }

    const [prod] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM catalog.products WHERE id = ${productId} AND brand_id = ${src.brand_id} LIMIT 1
    `)
    if (!prod) return { ok: false as const, reason: 'BRAND_MISMATCH' as const }

    const offerFk =
      supplier === SUPPLIER_DINAMIK ? Prisma.sql`dinamik_product_id` : Prisma.sql`basbug_product_id`

    // Bu ham satır zaten bir offer'a bağlı mı?
    const [linked] = await tx.$queryRaw<Array<{ one: number }>>(Prisma.sql`
      SELECT 1 AS one FROM catalog.product_offers WHERE ${offerFk} = ${supplierProductId} LIMIT 1
    `)
    if (linked) return { ok: false as const, reason: 'ALREADY_LINKED' as const }

    // Hedef ürünün bu tedarikçiden zaten offer'ı var mı? (unique product_id+supplier_code)
    const [conflict] = await tx.$queryRaw<Array<{ one: number }>>(Prisma.sql`
      SELECT 1 AS one FROM catalog.product_offers
      WHERE product_id = ${productId} AND supplier_code = ${supplier} LIMIT 1
    `)
    if (conflict) return { ok: false as const, reason: 'SUPPLIER_CONFLICT' as const }

    if (supplier === SUPPLIER_DINAMIK) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO catalog.product_offers (product_id, supplier_code, dinamik_product_id, supplier_sku)
        VALUES (${productId}, ${SUPPLIER_DINAMIK}, ${supplierProductId}, ${src.sku})
        ON CONFLICT DO NOTHING
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO catalog.product_match_candidates
          (product_id, supplier_code, dinamik_product_id, match_method, matched_code, confidence, status, reviewed_at, reviewed_by)
        SELECT ${productId}, ${SUPPLIER_DINAMIK}, ${supplierProductId}, 'MANUAL', ${src.s_key},
          (COALESCE(similarity(p.part_no_norm, ${src.s_key ?? ''}), 0) * 0.6 + COALESCE(similarity(p.name, ${src.s_name ?? ''}), 0) * 0.4),
          'APPROVED', NOW(), ${reviewedBy}
        FROM catalog.products p WHERE p.id = ${productId}
        ON CONFLICT (dinamik_product_id, product_id)
        DO UPDATE SET status = 'APPROVED', match_method = 'MANUAL', reviewed_at = NOW(), reviewed_by = EXCLUDED.reviewed_by
      `)
      await tx.$executeRaw(Prisma.sql`
        UPDATE catalog.product_match_candidates
        SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = 'auto:manual-sibling'
        WHERE dinamik_product_id = ${supplierProductId} AND status = 'PENDING' AND product_id <> ${productId}
      `)
    } else {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO catalog.product_offers (product_id, supplier_code, basbug_product_id, supplier_sku)
        VALUES (${productId}, ${SUPPLIER_BASBUG}, ${supplierProductId}, ${src.sku})
        ON CONFLICT DO NOTHING
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO catalog.product_match_candidates
          (product_id, supplier_code, basbug_product_id, match_method, matched_code, confidence, status, reviewed_at, reviewed_by)
        SELECT ${productId}, ${SUPPLIER_BASBUG}, ${supplierProductId}, 'MANUAL', ${src.s_key},
          (COALESCE(similarity(p.part_no_norm, ${src.s_key ?? ''}), 0) * 0.6 + COALESCE(similarity(p.name, ${src.s_name ?? ''}), 0) * 0.4),
          'APPROVED', NOW(), ${reviewedBy}
        FROM catalog.products p WHERE p.id = ${productId}
        ON CONFLICT (basbug_product_id, product_id)
        DO UPDATE SET status = 'APPROVED', match_method = 'MANUAL', reviewed_at = NOW(), reviewed_by = EXCLUDED.reviewed_by
      `)
      await tx.$executeRaw(Prisma.sql`
        UPDATE catalog.product_match_candidates
        SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = 'auto:manual-sibling'
        WHERE basbug_product_id = ${supplierProductId} AND status = 'PENDING' AND product_id <> ${productId}
      `)
    }

    return { ok: true as const, productId: productId.toString() }
  })
}

/**
 * Bir eşleşmeyi kaldırır (edit için): Dinamik/Başbuğ → offer'ı siler,
 * Parçatedarik → referans kaydını siler. Kanonik ürün silinmez.
 */
export async function unlinkSupplierRow(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
}): Promise<{ ok: boolean }> {
  const { supplier, supplierProductId } = input
  let deleted = 0
  if (supplier === 'ptdrk') {
    deleted = await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.product_ptdrk_refs WHERE ptdrk_product_id = ${supplierProductId}
    `)
  } else if (supplier === SUPPLIER_DINAMIK) {
    deleted = await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.product_offers WHERE dinamik_product_id = ${supplierProductId}
    `)
  } else {
    deleted = await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.product_offers WHERE basbug_product_id = ${supplierProductId}
    `)
  }
  return { ok: Number(deleted) > 0 }
}
