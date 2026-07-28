import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql, SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from '@/lib/catalog/catalog-sql'
import { canonicalNameSql, canonicalOverrideJoin } from '@/lib/catalog/canonical-name-sql'
import type {
  ListManualRowsResult,
  ManualCandidatesResult,
  ManualMatchBrand,
  ManualSimilarCandidate,
  ManualUnlinkedRow,
  CreateCanonicalProductResult,
  ProductListSupplier,
  ProductSupplierKey,
  UnmatchedRowConflict
} from './product-match-shared'

/**
 * Marka-kapsamlı manuel ürün eşleştirme çalışma alanı (SERVER-only).
 *
 * Akış (marka sekmesindeki SupplierBrandMatchSheet'e paralel):
 *   kanonik marka seç → o markanın APPROVED tedarikçi eşleşmeleri altındaki
 *   OFFER'I OLMAYAN dinamik/başbuğ ham satırlarını getir → seçilen satıra
 *   pg_trgm benzerlik oranıyla sıralı aday kanonik ürünleri göster →
 *   birini seçip offer oluştur (bağla).
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
  return value === 'dinamik' || value === 'basbug'
}

/**
 * Marka seçicisi: APPROVED eşleşmesi olan TÜM kanonik markalar + her birinin
 * altındaki offer'ı olmayan aktif dinamik/başbuğ ham satır sayısı.
 *
 * Manuel eşleştirme çalışma alanı içindir. Ürün listesindeki marka filtresi
 * ekrandaki diğer filtrelere uymak zorunda olduğu için oradan DEĞİL,
 * `listProductListBrandOptions`'tan beslenir.
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

  const approvedMapping = Prisma.sql`
    EXISTS (
      SELECT 1 FROM catalog.brand_mappings bm
      WHERE bm.brand_id = b.id AND bm.mapping_status = 'APPROVED'
    )`

  // Filtre için hafif yol: eşleşmemiş sayımı hesaplamaz (o tarama ~200ms sürer,
  // 1M+ offer'a karşı anti-join). Marka seçici bu bilgiye ihtiyaç duymaz.
  if (!withCounts) {
    const liteFilter = like ? Prisma.sql`AND b.brand ILIKE ${like}` : Prisma.empty
    const lite = await db.$queryRaw<Array<{ brand_id: number; brand_name: string }>>(Prisma.sql`
      SELECT b.id AS brand_id, b.brand AS brand_name
      FROM catalog.brands b
      WHERE ${approvedMapping}
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
    WHERE ${approvedMapping}
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


interface SourceRow {
  /** Gösterim adı (boşsa SKU'ya düşer). */
  name: string
  /** part_no (yoksa SKU) normalizasyonu — kanonik eşleştirme anahtarı. */
  key: string | null
  brandId: number
  sku: string
  /** SKU normalizasyonu — part_no anahtarı çakışınca yedek kimlik. */
  skuKey: string | null
  /** Ham part_no; yeni kanonik ürünün gösterim numarası olur. */
  partNo: string | null
  imageUrl: string | null
}

/** Seçilen ham satırın kimlik + gösterim alanları (benzerlik ve ürün açma kaynağı). */
async function loadSourceNameKey(
  supplier: ProductListSupplier,
  supplierProductId: bigint
): Promise<SourceRow | null> {
  type Raw = {
    s_name: string | null
    s_key: string | null
    brand_id: number
    sku: string
    sku_key: string | null
    part_no: string | null
    image_url: string | null
  }

  const [row] =
    supplier === SUPPLIER_DINAMIK
      ? await db.$queryRaw<Array<Raw>>(Prisma.sql`
          SELECT COALESCE(NULLIF(dp.stock_name, ''), dp.stock_code) AS s_name,
                 ${dnmkKey} AS s_key, bm.brand_id, dp.stock_code AS sku,
                 ${normCodeSql(Prisma.sql`dp.stock_code`)} AS sku_key,
                 dp.part_no, NULLIF(dp.image_url, '') AS image_url
          FROM catalog.supplier_dinamik_products dp
          JOIN catalog.brand_mappings bm
            ON bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
          WHERE dp.id = ${supplierProductId}
          LIMIT 1
        `)
      : await db.$queryRaw<Array<Raw>>(Prisma.sql`
          SELECT COALESCE(NULLIF(bp.aciklama, ''), bp.malzeme_no) AS s_name,
                 ${bsbgKey} AS s_key, bm.brand_id, bp.malzeme_no AS sku,
                 ${normCodeSql(Prisma.sql`bp.malzeme_no`)} AS sku_key,
                 bp.part_no, NULL::text AS image_url
          FROM catalog.supplier_basbug_products bp
          JOIN catalog.brand_mappings bm
            ON bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
          WHERE bp.id = ${supplierProductId}
          LIMIT 1
        `)

  if (!row) return null
  return {
    name: row.s_name ?? '',
    key: row.s_key,
    brandId: row.brand_id,
    sku: row.sku,
    skuKey: row.sku_key,
    partNo: row.part_no,
    imageUrl: row.image_url
  }
}

/**
 * Satırın part_no anahtarını çoktan kapmış kanonik ürün (varsa) + o ürünü aynı
 * tedarikçiden tutan offer'ın SKU'su. Eşleşmeyen satırların ezici çoğunluğu
 * burada takılı olduğu için modal bunu doğrudan gösterir.
 */
async function findKeyConflict(
  supplier: ProductListSupplier,
  src: SourceRow
): Promise<UnmatchedRowConflict | null> {
  if (!src.key) return null

  const [row] = await db.$queryRaw<
    Array<{ id: bigint; name: string; part_no: string; blocking_sku: string | null }>
  >(Prisma.sql`
    SELECT p.id, ${canonicalNameSql('p', 'ov')} AS name, p.part_no, po.supplier_sku AS blocking_sku
    FROM catalog.products p
    ${canonicalOverrideJoin('p', 'ov')}
    LEFT JOIN catalog.product_offers po
      ON po.product_id = p.id AND po.supplier_code = ${supplier}
    WHERE p.brand_id = ${src.brandId} AND p.part_no_norm = ${src.key}
    LIMIT 1
  `)

  if (!row) return null
  return {
    productId: row.id.toString(),
    name: row.name,
    partNo: row.part_no,
    blockingSku: row.blocking_sku
  }
}

const SIM_SCORE = (sKey: string | null, sName: string) => Prisma.sql`
  (
    COALESCE(similarity(p.part_no_norm, ${sKey ?? ''}), 0) * 0.6 +
    COALESCE(similarity(p.name, ${sName}), 0) * 0.4
  )
`

/**
 * Bir kaynak ham satıra pg_trgm benzerlik oranıyla sıralı aday kanonik ürünler
 * (aynı marka, bu tedarikçiden offer'ı olmayanlar).
 */
export async function searchSimilarCandidates(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
  limit?: number
}): Promise<ManualCandidatesResult> {
  const limit = Math.min(Math.max(1, input.limit ?? 20), 50)
  const src = await loadSourceNameKey(input.supplier, input.supplierProductId)
  if (!src) return { candidates: [] }

  const score = SIM_SCORE(src.key, src.name)
  const conflict = await findKeyConflict(input.supplier, src)

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
    -- Gösterilen ad override'lı; skor ham products.name üzerinden kalır
    -- (tedarikçi adlarıyla karşılaştırıldığı için sıralama değişmesin).
    SELECT p.id, ${canonicalNameSql('p', 'ov')} AS name, p.part_no, ${score} AS score,
      EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.product_id = p.id AND po.supplier_code = 'dinamik') AS has_dnmk,
      EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.product_id = p.id AND po.supplier_code = 'basbug') AS has_bsbg
    FROM catalog.products p
    ${canonicalOverrideJoin('p', 'ov')}
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

  return { candidates, conflict }
}

export type CreateCanonicalResult =
  | ({ ok: true } & CreateCanonicalProductResult)
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_LINKED' | 'KEY_CONFLICT' }

/**
 * Bağlanmamış bir ham satırdan YENİ kanonik ürün açar ve offer'ını bağlar.
 *
 * Kimlik seçimi: önce part_no anahtarı denenir; o anahtar aynı marka altında
 * doluysa (eşleşmeyen satırların normal hâli) satırın kendi SKU'su kimlik
 * olur — «ABA 251010741» gibi, uq(brand_id, part_no_norm) ile çakışmayan ama
 * satırı birebir temsil eden bir numara. SKU anahtarı da doluysa iş biter:
 * o ürün zaten bu satırın karşılığıdır, yenisi açılmamalıdır.
 *
 * Eşleştirme geçmişi manuel bağlamayla aynı şekilde denetime yazılır
 * (product_match_candidates, MANUAL/APPROVED).
 */
export async function createCanonicalProductFromSupplierRow(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
  createdBy: string | null
}): Promise<CreateCanonicalResult> {
  const { supplier, supplierProductId, createdBy } = input

  const src = await loadSourceNameKey(supplier, supplierProductId)
  if (!src || (!src.key && !src.skuKey)) return { ok: false as const, reason: 'NOT_FOUND' as const }

  const offerFk =
    supplier === SUPPLIER_DINAMIK ? Prisma.sql`dinamik_product_id` : Prisma.sql`basbug_product_id`

  return db.$transaction(async (tx) => {
    const [linked] = await tx.$queryRaw<Array<{ one: number }>>(Prisma.sql`
      SELECT 1 AS one FROM catalog.product_offers WHERE ${offerFk} = ${supplierProductId} LIMIT 1
    `)
    if (linked) return { ok: false as const, reason: 'ALREADY_LINKED' as const }

    const taken = await tx.$queryRaw<Array<{ part_no_norm: string }>>(Prisma.sql`
      SELECT part_no_norm FROM catalog.products
      WHERE brand_id = ${src.brandId}
        AND part_no_norm IN (${Prisma.join([src.key ?? '', src.skuKey ?? ''])})
    `)
    const takenKeys = new Set(taken.map((t) => t.part_no_norm))

    const usePartNoKey = src.key != null && !takenKeys.has(src.key)
    const useSkuKey = !usePartNoKey && src.skuKey != null && !takenKeys.has(src.skuKey)
    if (!usePartNoKey && !useSkuKey) return { ok: false as const, reason: 'KEY_CONFLICT' as const }

    const keyNorm = usePartNoKey ? src.key! : src.skuKey!
    // Gösterim numarası anahtarla aynı satırdan gelsin: part_no anahtarı
    // kullanıldıysa ham part_no, SKU'ya düşüldüyse SKU'nun kendisi.
    const partNoDisplay = usePartNoKey ? (src.partNo?.trim() || src.sku) : src.sku
    const name = src.name.trim() || partNoDisplay

    const [created] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      INSERT INTO catalog.products (brand_id, part_no, part_no_norm, name, primary_image_url)
      VALUES (${src.brandId}, ${partNoDisplay}, ${keyNorm}, ${name}, ${src.imageUrl})
      RETURNING id
    `)
    const productId = created.id

    // Slug refresh-product-rollups'takiyle aynı formülle üretilir; ürün
    // hemen mağaza adresine sahip olsun diye burada da doldurulur.
    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.products p
      SET slug = TRIM(BOTH '-' FROM
        LOWER(
          REGEXP_REPLACE(
            TRANSLATE(bl.brand || '-' || p.part_no, 'çğıöşüÇĞİÖŞÜ', 'cgiosucgiosu'),
            '[^a-zA-Z0-9]+', '-', 'g'
          )
        )
      ) || '-' || p.id
      FROM catalog.brands bl
      WHERE bl.id = p.brand_id AND p.id = ${productId} AND p.slug IS NULL
    `)

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_offers (product_id, supplier_code, ${offerFk}, supplier_sku)
      VALUES (${productId}, ${supplier}, ${supplierProductId}, ${src.sku})
      ON CONFLICT DO NOTHING
    `)

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_match_candidates
        (product_id, supplier_code, ${offerFk}, match_method, matched_code, confidence, status, reviewed_at, reviewed_by)
      VALUES (${productId}, ${supplier}, ${supplierProductId}, 'MANUAL', ${keyNorm}, 1.0,
              'APPROVED', NOW(), ${createdBy})
      ON CONFLICT (${offerFk}, product_id)
      DO UPDATE SET status = 'APPROVED', match_method = 'MANUAL', reviewed_at = NOW(),
                    reviewed_by = EXCLUDED.reviewed_by
    `)

    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.product_match_candidates
      SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = 'auto:manual-create-sibling'
      WHERE ${offerFk} = ${supplierProductId} AND status = 'PENDING' AND product_id <> ${productId}
    `)

    return {
      ok: true as const,
      productId: productId.toString(),
      partNo: partNoDisplay,
      name,
      usedSkuKey: useSkuKey
    }
  })
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
 */
export async function unlinkSupplierRow(input: {
  supplier: ProductListSupplier
  supplierProductId: bigint
}): Promise<{ ok: boolean }> {
  const { supplier, supplierProductId } = input
  let deleted = 0
  if (supplier === SUPPLIER_DINAMIK) {
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
