import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { SearchHit } from '@/lib/types/search'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl,
  type AvailabilityStatus
} from './availability'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'

const MAX_LIMIT = 60
const MIN_QUERY_LENGTH = 1
const MAX_CATALOG_ONLY = 30
const SUPPLIER_CANDIDATE_MULTIPLIER = 3

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim()
}

function toCompactCode(value: string): string {
  return value.replace(/[^0-9a-z]+/g, '')
}

type CatalogOfferSearchInput = {
  query: string
  filters?: {
    brands?: string[]
    categories?: string[]
    brandId?: number
    categoryId?: number
    minPrice?: number
    maxPrice?: number
    vehicleIds?: number[]
    inBasket?: boolean
  }
  page?: number
  limit?: number
}

export type CatalogOfferSearchResult = {
  products: CatalogOfferProduct[]
  page: number
  limit: number
  hasMore: boolean
  totalEstimate: number | null
  dataSource: 'postgres_catalog_offer_search'
  liveFallbackUsed: false
  durationMs: number
  purchasableCount: number
  requestPriceCount: number
  verifyFitmentCount: number
  outOfStockCount: number
}

export type CatalogOfferProduct = {
  partId: string | null
  supplierProductId: number | null
  title: string
  brand: string
  imageUrl: string | null
  price: string | null
  stockQty: number | null
  currency: string
  availabilityStatus: AvailabilityStatus
  cta: ReturnType<typeof resolveCTA>
  providerName: string | null
  oemCodes: string[]
  eanCodes: string[]
  detailUrl: string | null
  name: string
  brandName: string
  brandLogo: string | null
  categoryId: number | null
  categoryName: string | null
  categoryNameTr?: string | null
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  sourceType: 'part' | 'supplier_product'
  articleLinkId: string
  variantCount: number
  inBasket: boolean
  brandId: number | null
  images: { image: string | null; thumb: string | null }[]
  properties: { key: string; value: string; key_tr?: string | null; value_tr?: string | null }[]
  documentType?: 'canonical_part' | 'supplier_offer' | 'orphan_supplier_product'
  canonicalPartId?: string | null
  matchStatus?: 'APPROVED' | 'CANDIDATE' | 'QUEUE' | 'NEEDS_REVIEW' | 'UNMAPPED' | 'MANUAL'
  matchConfidence?: number | null
  matchReason?: string | null
  hasSupplierOffer?: boolean
  offerCount?: number
  bestOfferProvider?: string | null
  crossReferences?: string[]
  referenceNumbers?: string[]
  vehicleBrandNames?: string[]
  vehicleModelNames?: string[]
  fitmentCount?: number
}

type SupplierHitRow = {
  mapping_id: number
  provider_id: number
  supplier_product_id: number
  supplier_sku: string
  part_id: bigint | null
  match_reason: string | null
  is_manual: boolean
  provider_code: string
  provider_name: string
  sp_name: string | null
  sp_brand: string | null
  sp_sku: string
  sp_price: Prisma.Decimal | null
  sp_stock_qty: number
  sp_currency: string
  sp_image_url: string | null
  sp_last_seen_at: Date
  part_name: string | null
  part_article_link_id: bigint | null
  part_in_basket: boolean | null
  part_brand_id: number | null
  part_brand_name: string | null
  part_brand_logo_url: string | null
  part_category_id: number | null
  part_category_name: string | null
  part_category_name_tr: string | null
  oem_codes: string[]
  ean_codes: string[]
  part_images: { image: string | null; thumb: string | null }[]
  part_properties: { key: string; value: string }[]
  rank_tier: number
  rank_score: number
}

type CatalogHitRow = {
  part_id: bigint
  part_name: string
  part_article_link_id: bigint
  part_in_basket: boolean
  part_brand_id: number
  part_brand_name: string
  part_brand_logo_url: string | null
  part_category_id: number
  part_category_name: string | null
  part_category_name_tr: string | null
  part_price: Prisma.Decimal | null
  pi_supplier_price: Prisma.Decimal | null
  pi_computed_selling_price: Prisma.Decimal | null
  pi_supplier_stock_qty: number | null
  pi_reserved_stock_qty: number | null
  pi_currency: string | null
  pi_source_provider_id: number | null
  pi_source_supplier_product_id: number | null
  ao_lock_price: boolean | null
  ao_selling_price_override: Prisma.Decimal | null
  oem_codes: string[]
  ean_codes: string[]
  part_images: { image: string | null; thumb: string | null }[]
  part_properties: { key: string; value: string }[]
  has_mapping: boolean
  rank_tier: number
}

function escapeSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function escapeSqlLike(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')}'`
}

async function fetchSupplierBackedHits(
  query: string,
  filters: CatalogOfferSearchInput['filters'],
  limit: number
): Promise<SupplierHitRow[]> {
  const raw = query.trim()
  const folded = normalizeForSearch(raw)
  const compact = toCompactCode(folded)

  const searchNeedles = Array.from(
    new Set([raw, folded, compact].filter((s) => s.length >= 2))
  )
  if (searchNeedles.length === 0) return []

  const minPriceFilter = filters?.minPrice !== undefined
    ? `AND sp.supplier_price >= ${filters.minPrice}`
    : ''
  const maxPriceFilter = filters?.maxPrice !== undefined
    ? `AND sp.supplier_price <= ${filters.maxPrice}`
    : ''

  const exactSkuCTE = `
    SELECT sp.id, 0 AS rank_tier, 100 AS rank_score
    FROM supplier_products sp
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE sp.normalized_sku = LOWER(${escapeSqlLiteral(compact)})
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  `

  const exactOemCTE = `
    SELECT sp.id, 0 AS rank_tier, 90 AS rank_score
    FROM supplier_products sp
    JOIN supplier_product_oems spo ON spo.supplier_product_id = sp.id AND spo.is_active = true
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE spo.normalized_oem_code = LOWER(${escapeSqlLiteral(compact)})
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  `

  const exactEanCTE = `
    SELECT sp.id, 1 AS rank_tier, 80 AS rank_score
    FROM supplier_products sp
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE (sp.barcode_1 = ${escapeSqlLiteral(raw)} OR sp.barcode_2 = ${escapeSqlLiteral(raw)} OR sp.barcode_3 = ${escapeSqlLiteral(raw)})
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  `

  const brandExactCTE = !/^\d+$/.test(folded) ? `
    SELECT sp.id, 2 AS rank_tier, 50 AS rank_score
    FROM supplier_products sp
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE LOWER(sp.supplier_brand) = LOWER(${escapeSqlLiteral(raw)})
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  ` : 'SELECT NULL::int AS id, 99 AS rank_tier, 0 AS rank_score WHERE FALSE'

  const nameContainsCTE = `
    SELECT sp.id, 3 AS rank_tier, 30 AS rank_score
    FROM supplier_products sp
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE (sp.normalized_name ILIKE ${escapeSqlLike(folded)}
           OR sp.normalized_sku ILIKE ${escapeSqlLike(folded)})
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  `

  const oemContainsCTE = `
    SELECT DISTINCT sp.id, 3 AS rank_tier, 25 AS rank_score
    FROM supplier_products sp
    JOIN supplier_product_oems spo ON spo.supplier_product_id = sp.id AND spo.is_active = true
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE spo.normalized_oem_code ILIKE ${escapeSqlLike(compact)}
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')
      ${minPriceFilter}
      ${maxPriceFilter}
  `

  const brandIdFilter = filters?.brandId ? `AND pb.id = ${filters.brandId}` : ''
  const categoryIdFilter = filters?.categoryId ? `AND pc.id = ${filters.categoryId}` : ''

  const catalogBrandCTE = !/^\d+$/.test(folded) ? `
    SELECT DISTINCT p.id AS part_id_from_brand, 4 AS rank_tier, 40 AS rank_score
    FROM parts p
    JOIN part_brands pb ON pb.id = p.brand_id
    LEFT JOIN supplier_part_mappings spm2 ON spm2.part_id = p.id AND spm2.status = 'APPROVED'
    WHERE LOWER(pb.name) = LOWER(${escapeSqlLiteral(raw)})
      AND spm2.id IS NULL
      ${brandIdFilter}
      ${categoryIdFilter}
    LIMIT ${MAX_CATALOG_ONLY}
  ` : ''

  const takeLimit = Math.min(limit * SUPPLIER_CANDIDATE_MULTIPLIER, 200)

  const candidateSql = Prisma.sql`
    WITH ranked_candidates AS (
      ${Prisma.raw(exactSkuCTE)}
      UNION
      ${Prisma.raw(exactOemCTE)}
      UNION
      ${Prisma.raw(exactEanCTE)}
      UNION
      ${Prisma.raw(brandExactCTE)}
      UNION
      ${Prisma.raw(nameContainsCTE)}
      UNION
      ${Prisma.raw(oemContainsCTE)}
    ),
    deduped AS (
      SELECT id, MIN(rank_tier) AS rank_tier, MAX(rank_score) AS rank_score
      FROM ranked_candidates
      GROUP BY id
    )
    SELECT
      spm.id AS mapping_id,
      spm.provider_id,
      spm.supplier_product_id,
      spm.supplier_sku,
      spm.part_id,
      spm.match_reason,
      spm.is_manual,
      prv.code AS provider_code,
      prv.name AS provider_name,
      sp.supplier_name AS sp_name,
      sp.supplier_brand AS sp_brand,
      sp.supplier_sku AS sp_sku,
      sp.supplier_price AS sp_price,
      sp.supplier_stock_qty AS sp_stock_qty,
      sp.currency AS sp_currency,
      sp.image_url AS sp_image_url,
      sp.last_seen_at AS sp_last_seen_at,
      p.name AS part_name,
      p.article_link_id AS part_article_link_id,
      p.in_basket AS part_in_basket,
      p.brand_id AS part_brand_id,
      pb.name AS part_brand_name,
      pb.logo_url AS part_brand_logo_url,
      p.category_id AS part_category_id,
      pc.name AS part_category_name,
      pc.name_tr AS part_category_name_tr,
      COALESCE(
        (SELECT JSONB_AGG(sub.oem_code) FROM (
          SELECT spo2.oem_code FROM supplier_product_oems spo2
          WHERE spo2.supplier_product_id = sp.id AND spo2.is_active = true
          ORDER BY spo2.updated_at DESC LIMIT 6
        ) sub), '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code)
         FROM part_eans pe
         WHERE pe.part_id = spm.part_id
         LIMIT 6), '[]'::jsonb
      ) AS ean_codes,
      COALESCE(
        (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('image', pi.image, 'thumb', pi.thumb))
         FROM part_images pi
         WHERE pi.part_id = COALESCE(spm.part_id, p.id)
         LIMIT 2), '[]'::jsonb
      ) AS part_images,
      COALESCE(
        (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('key', pp.key, 'value', pp.value))
         FROM part_properties pp
         WHERE pp.part_id = COALESCE(spm.part_id, p.id)
         LIMIT 4), '[]'::jsonb
      ) AS part_properties,
      d.rank_tier,
      d.rank_score
    FROM deduped d
    JOIN supplier_products sp ON sp.id = d.id
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    JOIN supplier_providers prv ON prv.id = sp.provider_id
    LEFT JOIN parts p ON p.id = spm.part_id
    LEFT JOIN part_brands pb ON pb.id = p.brand_id
    LEFT JOIN part_categories pc ON pc.id = p.category_id
    ORDER BY d.rank_tier, d.rank_score DESC, sp.supplier_stock_qty DESC, sp.last_seen_at DESC
    LIMIT ${takeLimit}
  `

  const rows = await db.$queryRaw<SupplierHitRow[]>(candidateSql)
  return rows
}

async function fetchCatalogOnlyHits(
  query: string,
  filters: CatalogOfferSearchInput['filters'],
  existingPartIds: Set<string>,
  limit: number
): Promise<CatalogHitRow[]> {
  const raw = query.trim()
  const folded = normalizeForSearch(raw)

  if (/^\d+$/.test(folded)) return []

  const andConds: string[] = []
  andConds.push(`(LOWER(p.name) ILIKE ${escapeSqlLike(folded)} OR LOWER(pb.name) = LOWER(${escapeSqlLiteral(raw)}))`)

  if (existingPartIds.size > 0) {
    const idList = Array.from(existingPartIds).slice(0, 5000).join(',')
    andConds.push(`p.id NOT IN (${idList})`)
  }

  andConds.push(`NOT EXISTS (SELECT 1 FROM supplier_part_mappings spm WHERE spm.part_id = p.id AND spm.status = 'APPROVED')`)

  if (filters?.brandId) andConds.push(`p.brand_id = ${filters.brandId}`)
  if (filters?.categoryId) andConds.push(`p.category_id = ${filters.categoryId}`)
  if (filters?.inBasket !== undefined) andConds.push(`p.in_basket = ${filters.inBasket ? 'true' : 'false'}`)

  const safeLimit = Math.min(Math.max(limit, 5), MAX_CATALOG_ONLY)

  const sql = Prisma.sql`
    SELECT
      p.id AS part_id,
      p.name AS part_name,
      p.article_link_id AS part_article_link_id,
      p.in_basket AS part_in_basket,
      p.brand_id AS part_brand_id,
      pb.name AS part_brand_name,
      pb.logo_url AS part_brand_logo_url,
      p.category_id AS part_category_id,
      pc.name AS part_category_name,
      pc.name_tr AS part_category_name_tr,
      p.price AS part_price,
      pi.supplier_price AS pi_supplier_price,
      pi.computed_selling_price_ex_vat AS pi_computed_selling_price,
      pi.supplier_stock_qty AS pi_supplier_stock_qty,
      pi.reserved_stock_qty AS pi_reserved_stock_qty,
      pi.currency AS pi_currency,
      pi.source_provider_id AS pi_source_provider_id,
      pi.source_supplier_product_id AS pi_source_supplier_product_id,
      ao.lock_price AS ao_lock_price,
      ao.selling_price_override AS ao_selling_price_override,
      COALESCE(
        (SELECT JSONB_AGG(po.code) FROM part_oens po WHERE po.part_id = p.id LIMIT 6),
        '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code) FROM part_eans pe WHERE pe.part_id = p.id LIMIT 6),
        '[]'::jsonb
      ) AS ean_codes,
      COALESCE(
        (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('image', pim.image, 'thumb', pim.thumb))
         FROM part_images pim WHERE pim.part_id = p.id LIMIT 2),
        '[]'::jsonb
      ) AS part_images,
      COALESCE(
        (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('key', pp.key, 'value', pp.value))
         FROM part_properties pp WHERE pp.part_id = p.id LIMIT 4),
        '[]'::jsonb
      ) AS part_properties,
      EXISTS (SELECT 1 FROM supplier_part_mappings spm WHERE spm.part_id = p.id AND spm.status = 'APPROVED') AS has_mapping,
      5 AS rank_tier
    FROM parts p
    JOIN part_brands pb ON pb.id = p.brand_id
    JOIN part_categories pc ON pc.id = p.category_id
    LEFT JOIN part_pricing_inventory pi ON pi.part_id = p.id
    LEFT JOIN part_admin_overrides ao ON ao.part_id = p.id
    WHERE ${Prisma.raw(andConds.join(' AND '))}
    ORDER BY
      CASE WHEN pi.computed_selling_price_ex_vat IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN pi.supplier_stock_qty > 0 THEN 0 ELSE 1 END,
      p.updated_at DESC
    LIMIT ${safeLimit}
  `

  const rows = await db.$queryRaw<CatalogHitRow[]>(sql)
  return rows
}

function mapSupplierHitToProduct(row: SupplierHitRow): CatalogOfferProduct {
  const partId = row.part_id?.toString() ?? null
  const supplierProductId = row.supplier_product_id
  const realPriceExVat = row.sp_price
  const hasRealPrice = realPriceExVat != null
  const stockQty = Math.max(0, row.sp_stock_qty || 0)
  const availability = resolveAvailabilityStatus({
    hasRealPrice,
    availableStock: stockQty,
    hasSupplierOffer: true,
    hasPartId: Boolean(partId)
  })
  const cta = resolveCTA(availability)
  const detailUrl = resolveDetailUrl({ partId, supplierProductId })
  const title = row.sp_name || `${row.provider_code} ${row.sp_sku}`.trim()
  const brand = row.sp_brand || row.part_brand_name || row.provider_code
  const providerName = row.provider_name || row.provider_code || null

  return {
    partId,
    supplierProductId,
    title,
    brand,
    imageUrl: row.sp_image_url,
    price: hasRealPrice ? decimalToString(realPriceExVat) : null,
    stockQty,
    currency: row.sp_currency || 'TRY',
    availabilityStatus: availability,
    cta,
    providerName,
    oemCodes: Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, 6) : [],
    eanCodes: Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, 6) : [],
    detailUrl,
    name: row.part_name || title,
    brandName: row.part_brand_name || brand,
    brandLogo: row.part_brand_logo_url,
    categoryId: row.part_category_id,
    categoryName: row.part_category_name || row.part_category_name_tr,
    priceSource: hasRealPrice ? 'real' : 'placeholder',
    isPlaceholderPrice: !hasRealPrice,
    isPurchasable: hasRealPrice && stockQty > 0,
    sourceType: 'supplier_product',
    articleLinkId: row.part_article_link_id?.toString() ?? row.supplier_product_id.toString(),
    variantCount: 1,
    inBasket: row.part_in_basket ?? false,
    brandId: row.part_brand_id,
    images: Array.isArray(row.part_images) ? row.part_images : [],
    properties: Array.isArray(row.part_properties)
      ? row.part_properties.map((p) => ({ key: p.key, value: p.value, key_tr: null, value_tr: null }))
      : []
  }
}

function mapCatalogHitToProduct(row: CatalogHitRow): CatalogOfferProduct {
  const partId = row.part_id.toString()
  const realPriceExVat =
    row.ao_lock_price && row.ao_selling_price_override
      ? row.ao_selling_price_override
      : row.pi_computed_selling_price ?? row.pi_supplier_price ?? row.part_price ?? null
  const hasRealPrice = realPriceExVat != null
  const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? 0)
  const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
  const availability = resolveAvailabilityStatus({
    hasRealPrice,
    availableStock,
    hasSupplierOffer: row.has_mapping,
    hasPartId: true
  })
  const cta = resolveCTA(availability)
  const detailUrl = resolveDetailUrl({ partId })

  return {
    partId,
    supplierProductId: row.pi_source_supplier_product_id ?? null,
    title: row.part_name,
    brand: row.part_brand_name,
    imageUrl: row.part_images?.[0]?.image ?? row.part_images?.[0]?.thumb ?? null,
    price: hasRealPrice ? decimalToString(realPriceExVat) : null,
    stockQty: availableStock,
    currency: row.pi_currency || 'TRY',
    availabilityStatus: availability,
    cta,
    providerName: null,
    oemCodes: Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, 6) : [],
    eanCodes: Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, 6) : [],
    detailUrl,
    name: row.part_name,
    brandName: row.part_brand_name,
    brandLogo: row.part_brand_logo_url,
    categoryId: row.part_category_id,
    categoryName: row.part_category_name || row.part_category_name_tr,
    priceSource: hasRealPrice ? 'real' : 'placeholder',
    isPlaceholderPrice: !hasRealPrice,
    isPurchasable: hasRealPrice && availableStock > 0,
    sourceType: 'part',
    articleLinkId: row.part_article_link_id.toString(),
    variantCount: 1,
    inBasket: row.part_in_basket ?? false,
    brandId: row.part_brand_id,
    images: Array.isArray(row.part_images) ? row.part_images : [],
    properties: Array.isArray(row.part_properties)
      ? row.part_properties.map((p) => ({ key: p.key, value: p.value, key_tr: null, value_tr: null }))
      : []
  }
}

export function catalogOfferProductToSearchHit(
  product: CatalogOfferProduct
): SearchHit {
  return {
    id: product.partId ?? String(product.supplierProductId ?? ''),
    name: product.name || product.title,
    articleLinkId: product.articleLinkId,
    dedupeKey: product.partId
      ? `part:${product.partId}`
      : `supplier:${product.supplierProductId}`,
    variantCount: product.variantCount,
    price: product.price,
    stockQty: product.stockQty ?? 0,
    priceSource: product.priceSource,
    isPlaceholderPrice: product.isPlaceholderPrice,
    isPurchasable: product.isPurchasable,
    inBasket: product.inBasket,
    brandId: product.brandId ?? 0,
    brandName: product.brandName,
    brandLogo: product.brandLogo,
    categoryId: product.categoryId ?? 0,
    categoryName: product.categoryName,
    categoryNameTr: product.categoryNameTr ?? null,
    oemCodes: product.oemCodes,
    oemBrands: [],
    vehicleTypes: [],
    vehicleIds: [],
    vehicleNames: [],
    formattedCompatibility: [],
    searchableText: [product.name, product.brandName, product.title, product.brand]
      .filter(Boolean)
      .join(' '),
    images: product.images,
    properties: product.properties,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceType: product.sourceType,
    resolvedPartId: product.partId ?? undefined,
    supplierProductId: product.supplierProductId,
    providerCode: product.providerName,
    supplierSku: undefined,
    matchType: product.sourceType === 'supplier_product' ? 'approved_oem_mapping' : undefined,
    canonicalKey: product.partId ? `part:${product.partId}` : undefined,
    rankBucket:
      product.availabilityStatus === 'PURCHASABLE'
        ? 1
        : product.availabilityStatus === 'OUT_OF_STOCK'
          ? 2
          : 3,
    availabilityStatus: product.availabilityStatus,
    cta: product.cta,
    detailUrl: product.detailUrl,
    documentType: product.documentType ?? (product.sourceType === 'part' ? 'canonical_part' : 'supplier_offer'),
    canonicalPartId: product.canonicalPartId ?? product.partId ?? null,
    matchStatus: product.matchStatus ?? 'APPROVED',
    matchConfidence: product.matchConfidence ?? null,
    matchReason: product.matchReason ?? null,
    hasSupplierOffer: product.hasSupplierOffer ?? (product.sourceType === 'supplier_product'),
    offerCount: product.offerCount ?? 0,
    bestOfferProvider: product.bestOfferProvider ?? null,
    crossReferences: product.crossReferences ?? [],
    referenceNumbers: product.referenceNumbers ?? [],
    vehicleBrandNames: product.vehicleBrandNames ?? [],
    vehicleModelNames: product.vehicleModelNames ?? [],
    fitmentCount: product.fitmentCount ?? 0
  }
}

function countByStatus(products: CatalogOfferProduct[]) {
  let purchasableCount = 0
  let requestPriceCount = 0
  let verifyFitmentCount = 0
  let outOfStockCount = 0

  for (const product of products) {
    switch (product.availabilityStatus) {
      case 'PURCHASABLE':
        purchasableCount++
        break
      case 'REQUEST_PRICE':
        requestPriceCount++
        break
      case 'VERIFY_FITMENT':
        verifyFitmentCount++
        break
      case 'OUT_OF_STOCK':
        outOfStockCount++
        break
    }
  }

  return { purchasableCount, requestPriceCount, verifyFitmentCount, outOfStockCount }
}

function deduplicateProducts(products: CatalogOfferProduct[]): CatalogOfferProduct[] {
  const seen = new Set<string>()
  return products.filter((product) => {
    const key = product.partId
      ? `part:${product.partId}`
      : product.supplierProductId
        ? `sp:${product.supplierProductId}`
        : null
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function runCatalogOfferSearch(
  input: CatalogOfferSearchInput
): Promise<CatalogOfferSearchResult> {
  const start = performance.now()

  const query = (input.query ?? '').trim()
  const page = Math.max(1, input.page ?? 1)
  const rawLimit = Math.max(1, Math.min(input.limit ?? 24, MAX_LIMIT))
  const filters = input.filters ?? {}

  if (query.length < MIN_QUERY_LENGTH) {
    const elapsed = performance.now() - start
    return {
      products: [],
      page,
      limit: rawLimit,
      hasMore: false,
      totalEstimate: 0,
      dataSource: 'postgres_catalog_offer_search',
      liveFallbackUsed: false,
      durationMs: elapsed,
      purchasableCount: 0,
      requestPriceCount: 0,
      verifyFitmentCount: 0,
      outOfStockCount: 0
    }
  }

  const supplierProducts = await fetchSupplierBackedHits(query, filters, rawLimit)
  const supplierMapped = supplierProducts.map(mapSupplierHitToProduct)

  const existingPartIds = new Set<string>(
    supplierMapped
      .filter((p) => p.partId)
      .map((p) => p.partId!)
  )

  const catalogLimit = Math.max(MAX_CATALOG_ONLY - supplierMapped.length, 0)
  const catalogProducts =
    catalogLimit > 0
      ? await fetchCatalogOnlyHits(query, filters, existingPartIds, catalogLimit)
      : []
  const catalogMapped = catalogProducts.map(mapCatalogHitToProduct)

  const allProducts = deduplicateProducts([...supplierMapped, ...catalogMapped])

  allProducts.sort((a, b) => {
    const aRank =
      a.availabilityStatus === 'PURCHASABLE'
        ? 0
        : a.availabilityStatus === 'OUT_OF_STOCK'
          ? 1
          : 2
    const bRank =
      b.availabilityStatus === 'PURCHASABLE'
        ? 0
        : b.availabilityStatus === 'OUT_OF_STOCK'
          ? 1
          : 2
    if (aRank !== bRank) return aRank - bRank

    if (a.sourceType === 'supplier_product' && b.sourceType !== 'supplier_product')
      return -1
    if (a.sourceType !== 'supplier_product' && b.sourceType === 'supplier_product')
      return 1

    const aStock = a.stockQty ?? 0
    const bStock = b.stockQty ?? 0
    if (aStock !== bStock) return bStock - aStock

    return 0
  })

  const offset = (page - 1) * rawLimit
  const pagedProducts = allProducts.slice(offset, offset + rawLimit)
  const hasMore = allProducts.length > offset + rawLimit

  const counts = countByStatus(pagedProducts)
  const elapsed = performance.now() - start

  return {
    products: pagedProducts,
    page,
    limit: rawLimit,
    hasMore,
    totalEstimate: allProducts.length,
    dataSource: 'postgres_catalog_offer_search',
    liveFallbackUsed: false,
    durationMs: elapsed,
    ...counts
  }
}