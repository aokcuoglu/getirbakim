import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type {
  SearchDocumentAvailability,
  MatchStatus
} from './search-document-types'

/**
 * Canonical Meilisearch document, sourced from the `catalog` schema
 * (catalog.products + rollups + enrichment). This is the shape the read path
 * — lib/search/category-products-meili.ts and the /api/search route — expects.
 * It replaces the deleted parts-based builder; every sellable catalog product
 * becomes one `canonical_part` document that links to /urun/{slug}.
 */
export interface SearchDocument {
  id: string
  documentType: 'canonical_part'
  partId: string | null
  canonicalPartId: string | null
  title: string
  name: string
  articleLinkId: string

  brand: string | null
  brandName: string | null
  brandId: number | null
  brandLogo: string | null

  categoryId: number | null
  categoryName: string | null
  categoryNameTr: string | null
  categorySlug: string | null

  oemCodes: string[]
  eanCodes: string[]
  crossReferences: string[]
  referenceNumbers: string[]
  exactCodes: string[]
  normalizedSearchText: string
  searchKeywords: string[]
  synonymsText: string

  price: number | null
  hasPrice: boolean
  stockQty: number
  hasStock: boolean
  availabilityStatus: SearchDocumentAvailability

  matchStatus: MatchStatus
  sourceType: 'part'
  providerCode: string | null
  supplierSku: string | null
  supplierProductId: number | null

  hasSupplierOffer: boolean
  offerCount: number
  bestOfferProvider: string | null

  vehicleBrandNames: string[]
  vehicleModelNames: string[]
  vehicleTypeNames: string[]
  engineCodes: string[]
  fitmentCount: number

  detailUrl: string | null
  imageUrl: string | null
  rankScore: number
  updatedAt: number
}

interface CatalogDocRow {
  id: string
  part_no: string
  part_no_norm: string
  name: string
  name_override: string | null
  slug: string | null
  brand_id: number
  brand_name: string
  brand_logo: string | null
  category_id: number | null
  category_name: string | null
  category_name_tr: string | null
  category_url_key: string | null
  min_selling_price_try: string | null
  total_stock_qty: number
  in_stock: boolean
  offer_count: number
  primary_image_url: string | null
  updated_at: Date
  oem_codes: string[] | null
  ean_codes: string[] | null
  vehicle_brand_names: string[] | null
  vehicle_model_names: string[] | null
  vehicle_type_names: string[] | null
  fitment_count: number
}

const SELECT_SQL = Prisma.sql`
  SELECT
    p.id::text                         AS id,
    p.part_no,
    p.part_no_norm,
    p.name,
    o.name_override,
    p.slug,
    p.brand_id,
    bl.brand                           AS brand_name,
    bl.logo_url                        AS brand_logo,
    COALESCE(o.category_override_id, p.category_id) AS category_id,
    c.name                             AS category_name,
    c.name_tr                          AS category_name_tr,
    c.url_key                          AS category_url_key,
    p.min_selling_price_try::text      AS min_selling_price_try,
    p.total_stock_qty,
    p.in_stock,
    p.offer_count,
    p.primary_image_url,
    p.updated_at,
    oem.codes                          AS oem_codes,
    ean.codes                          AS ean_codes,
    veh.brand_names                    AS vehicle_brand_names,
    veh.model_names                    AS vehicle_model_names,
    veh.type_names                     AS vehicle_type_names,
    COALESCE(veh.fitment_count, 0)::int AS fitment_count
  FROM catalog.products p
  JOIN catalog.brands bl ON bl.id = p.brand_id
  LEFT JOIN catalog.product_overrides o ON o.product_id = p.id
  LEFT JOIN public.part_categories c
    ON c.id = COALESCE(o.category_override_id, p.category_id)
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT code) AS codes
    FROM catalog.product_oems WHERE product_id = p.id
  ) oem ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT code) AS codes
    FROM catalog.product_eans WHERE product_id = p.id
  ) ean ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      array_agg(DISTINCT vb.name) AS brand_names,
      array_agg(DISTINCT vm.name) AS model_names,
      array_agg(DISTINCT vt.name) AS type_names,
      COUNT(*)                    AS fitment_count
    FROM catalog.product_vehicle_types pvt
    JOIN catalog.vehicle_types vt  ON vt.id = pvt.vehicle_type_id
    JOIN catalog.vehicle_models vm ON vm.id = vt.model_id
    JOIN catalog.vehicle_brands vb ON vb.id = vm.brand_id
    WHERE pvt.product_id = p.id
  ) veh ON TRUE
`

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function rankScore(row: CatalogDocRow, hasPrice: boolean): number {
  let score = 0
  if (row.in_stock) score += 1000
  score += Math.min(row.offer_count, 10) * 10
  if (hasPrice) score += 5
  if (row.primary_image_url) score += 2
  return score
}

function rowToDocument(row: CatalogDocRow): SearchDocument {
  const price = row.min_selling_price_try != null ? Number(row.min_selling_price_try) : null
  const hasPrice = price != null && Number.isFinite(price)
  const inStock = row.in_stock && row.total_stock_qty > 0

  const availabilityStatus: SearchDocumentAvailability = hasPrice
    ? inStock
      ? 'PURCHASABLE'
      : 'OUT_OF_STOCK'
    : 'REQUEST_PRICE'

  const displayName =
    row.name_override && row.name_override.trim().length > 0
      ? row.name_override.trim()
      : row.name

  const oemCodes = (row.oem_codes ?? []).filter(Boolean)
  const eanCodes = (row.ean_codes ?? []).filter(Boolean)
  const exactCodes = Array.from(
    new Set([row.part_no_norm, ...oemCodes.map(normalizeCode)].filter(Boolean))
  )

  const detailUrl = row.slug ? `/urun/${row.slug}` : null

  return {
    id: row.id,
    documentType: 'canonical_part',
    partId: row.id,
    canonicalPartId: row.id,
    title: displayName,
    name: displayName,
    articleLinkId: row.id,

    brand: row.brand_name,
    brandName: row.brand_name,
    brandId: row.brand_id,
    brandLogo: row.brand_logo,

    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryNameTr: row.category_name_tr,
    categorySlug: row.category_url_key,

    oemCodes,
    eanCodes,
    crossReferences: [],
    referenceNumbers: [],
    exactCodes,
    normalizedSearchText: `${row.brand_name} ${row.part_no} ${displayName}`.toLowerCase(),
    searchKeywords: [],
    synonymsText: '',

    price,
    hasPrice,
    stockQty: row.total_stock_qty,
    hasStock: inStock,
    availabilityStatus,

    matchStatus: 'APPROVED',
    sourceType: 'part',
    providerCode: null,
    supplierSku: null,
    supplierProductId: null,

    hasSupplierOffer: row.offer_count > 0,
    offerCount: row.offer_count,
    bestOfferProvider: null,

    vehicleBrandNames: (row.vehicle_brand_names ?? []).filter(Boolean),
    vehicleModelNames: (row.vehicle_model_names ?? []).filter(Boolean),
    vehicleTypeNames: (row.vehicle_type_names ?? []).filter(Boolean),
    engineCodes: [],
    fitmentCount: row.fitment_count,

    detailUrl,
    imageUrl: row.primary_image_url,
    rankScore: rankScore(row, hasPrice),
    updatedAt: row.updated_at.getTime()
  }
}

/** Build documents for an explicit set of catalog product ids (incremental). */
export async function buildCatalogSearchDocumentsBatch(
  productIds: bigint[]
): Promise<SearchDocument[]> {
  if (productIds.length === 0) return []
  const idList = Prisma.join(productIds)
  const rows = await db.$queryRaw<CatalogDocRow[]>(Prisma.sql`
    ${SELECT_SQL}
    WHERE p.status = 'ACTIVE' AND p.slug IS NOT NULL AND p.id IN (${idList})
  `)
  return rows.map(rowToDocument)
}

/**
 * Keyset-paginated full backfill over every ACTIVE catalog product with a slug.
 * Keyset (id > lastId) instead of OFFSET so 1M rows stay fast to the tail.
 */
export async function buildAllCatalogSearchDocumentsPaginated(
  batchSize = 1000,
  onBatch?: (docs: SearchDocument[], total: number) => Promise<void>
): Promise<number> {
  let lastId = BigInt(0)
  let total = 0

  while (true) {
    const rows = await db.$queryRaw<CatalogDocRow[]>(Prisma.sql`
      ${SELECT_SQL}
      WHERE p.status = 'ACTIVE' AND p.slug IS NOT NULL AND p.id > ${lastId}
      ORDER BY p.id
      LIMIT ${batchSize}
    `)

    if (rows.length === 0) break

    const docs = rows.map(rowToDocument)
    total += docs.length
    await onBatch?.(docs, total)

    lastId = BigInt(rows[rows.length - 1].id)
    if (rows.length < batchSize) break
  }

  return total
}
