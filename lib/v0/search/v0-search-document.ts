import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { dproductBrandNameExpr, dproductDbrandLeftJoin } from '@/lib/sql/dproduct-catalog'
import { compactCode, normalizeCode } from '@/lib/search/code-normalization'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dproduct-details'
import { dbrandsMatchBrandNameExpr } from '@/lib/v0/dbrandsMatchBrandNameSql'
import { dbrandsMatchLogoExpr } from '@/lib/v0/dbrandsMatchLogoSql'
import { extractDproductRawSearchText } from '@/lib/v0/search/v0-raw-search-text'
import { stripLeadingBrandPrefix } from '@/lib/product-display-name'
import { toBrandSlug } from '@/lib/v0/brandSlug'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

export type V0MeiliDocumentType = 'v0_product' | 'v0_brand'

export type V0MeiliDocument = {
  id: string
  documentType: V0MeiliDocumentType
  matchId: number
  name: string
  brandName: string
  title: string | null
  model: string | null
  sku: string | null
  refNo: string | null
  rawText: string | null
  brandLogo: string | null
  image: string | null
  price: number | null
  stockQty: number
  oemCodes: string[]
  searchableText: string
  detailUrl: string
}

export type DpmatchIndexRow = {
  id: number
  stock_code: string | null
  stock_name: string | null
  brand: string | null
  part_no: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  title: string | null
  model: string | null
  ref_no: string | null
  normalized: string | null
  dinamik_price: string | null
  dinamik_stock_qty: number | null
  pt_price: string | null
  image_url: string | null
  manufacturer_name: string | null
  matched_brand: string | null
  dinamik_raw: unknown
  brand_logo_url: string | null
}

type BrandIndexRow = {
  id: number
  brand_name: string
  pt_url_key: string | null
  logo_url: string | null
}

function resolveProductName(row: DpmatchIndexRow, brandName: string): string {
  const rawName =
    row.title?.trim() ||
    row.stock_name?.trim() ||
    row.stock_code?.trim() ||
    row.model?.trim() ||
    'Product'
  return stripLeadingBrandPrefix(rawName, brandName)
}

/** Part numbers and barcodes only — cross-ref ref_no is indexed separately at lower priority. */
function collectOemCodes(row: DpmatchIndexRow): string[] {
  const raw = [
    row.part_no,
    row.barcode_1,
    row.barcode_2,
    row.barcode_3,
    row.model,
    row.normalized,
    row.stock_code
  ].filter((value): value is string => Boolean(value?.trim()))

  const codes = new Set<string>()
  for (const value of raw) {
    codes.add(value)
    const normalized = normalizeCode(value)
    if (normalized) codes.add(normalized)
    const compact = compactCode(value)
    if (compact) codes.add(compact)
  }
  return [...codes]
}

function parsePrice(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveCanonicalBrandName(row: DpmatchIndexRow): string {
  return (
    row.matched_brand?.trim() ||
    row.brand?.trim() ||
    row.manufacturer_name?.trim() ||
    'Unknown'
  )
}

export function mapDpmatchRowToMeiliDoc(row: DpmatchIndexRow): V0MeiliDocument {
  const brandName = resolveCanonicalBrandName(row)
  const name = resolveProductName(row, brandName)
  const price =
    parsePrice(row.pt_price) ?? parsePrice(row.dinamik_price)
  const oemCodes = collectOemCodes(row)
  const title = row.title?.trim() || null
  const model = row.model?.trim() || null
  const sku = row.stock_code?.trim() || model
  const refNo = row.ref_no?.trim() || null
  const rawText = extractDproductRawSearchText(row.dinamik_raw) || null

  return {
    id: `p-${row.id}`,
    documentType: 'v0_product',
    matchId: row.id,
    name,
    brandName,
    title,
    model,
    sku,
    refNo,
    rawText,
    brandLogo: row.brand_logo_url?.trim() || null,
    image: row.image_url?.trim() || null,
    price,
    stockQty: row.dinamik_stock_qty ?? 0,
    oemCodes,
    searchableText: [brandName, name, title, model, sku, rawText, refNo, ...oemCodes]
      .filter(Boolean)
      .join(' '),
    detailUrl: `/part/${row.id}`
  }
}

export function mapBrandRowToMeiliDoc(row: BrandIndexRow): V0MeiliDocument {
  const brandName = row.brand_name.trim()
  const slug = toBrandSlug(row.pt_url_key, brandName)
  return {
    id: `b-${row.id}`,
    documentType: 'v0_brand',
    matchId: row.id,
    name: brandName,
    brandName,
    title: null,
    model: null,
    sku: null,
    refNo: null,
    rawText: null,
    brandLogo: row.logo_url?.trim() || null,
    image: row.logo_url?.trim() || null,
    price: null,
    stockQty: 0,
    oemCodes: [],
    searchableText: brandName,
    detailUrl: `/b/${slug}`
  }
}

export const DPMATCH_INDEX_SELECT = Prisma.sql`
  SELECT
    m.id,
    d.stock_code,
    d.stock_name,
    ${dproductBrandNameExpr} AS brand,
    d.part_no,
    d.barcode_1,
    d.barcode_2,
    d.barcode_3,
    p.title,
    p.model,
    p.ref_no,
    m.normalized,
    ${dproductDetailsPriceExpr}::text AS dinamik_price,
    ${dproductDetailsStockExpr} AS dinamik_stock_qty,
    p.price::text AS pt_price,
    p.image_url,
    mfr.name AS manufacturer_name,
    ${dbrandsMatchBrandNameExpr} AS matched_brand,
    o.raw AS dinamik_raw,
    ${dbrandsMatchLogoExpr} AS brand_logo_url
  FROM v0.dpmatch m
  INNER JOIN v0.dproducts d ON d.id = m.dproducts_id
  ${dproductDbrandLeftJoin}
  LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
  LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
  ${dproductDetailsJoin}
  WHERE m.mapping_status = 'APPROVED'
    AND d.is_passive IS DISTINCT FROM TRUE
`

const BRANDS_INDEX_SELECT = Prisma.sql`
  WITH approved AS (
    SELECT
      a.id,
      a.normalized,
      a.logo_url,
      d.brand AS dinamik_brand,
      m.name AS ptbrand_name,
      m.url_key AS pt_url_key
    FROM v0.dbrands_match a
    LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
    LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
    WHERE a.mapping_status = 'APPROVED'
      AND BTRIM(COALESCE(a.normalized, d.brand, m.name, '')) <> ''
  ),
  with_key AS (
    SELECT
      *,
      COALESCE(
        NULLIF(BTRIM(normalized), ''),
        'id:' || id::text
      ) AS group_key
    FROM approved
  ),
  grouped AS (
    SELECT
      MIN(id) AS id,
      COALESCE(
        MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
        MAX(NULLIF(BTRIM(normalized), '')),
        MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
      ) AS brand_name,
      MAX(pt_url_key) AS pt_url_key,
      MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
    FROM with_key
    GROUP BY group_key
  )
  SELECT g.id, g.brand_name, g.pt_url_key, g.logo_url FROM grouped g
`

const V0_MEILI_PRODUCT_FETCH_BATCH = 2_000

export async function fetchV0MeiliProductDocumentsPage(options: {
  offset: number
  limit?: number
}): Promise<V0MeiliDocument[]> {
  const limit = options.limit ?? V0_MEILI_PRODUCT_FETCH_BATCH
  const productRows = await db.$queryRaw<DpmatchIndexRow[]>(Prisma.sql`
    ${DPMATCH_INDEX_SELECT}
    ORDER BY m.id ASC
    LIMIT ${limit}
    OFFSET ${options.offset}
  `)
  return productRows.map(mapDpmatchRowToMeiliDoc)
}

export async function fetchV0MeiliBrandDocuments(): Promise<V0MeiliDocument[]> {
  const brandRows = await db.$queryRaw<BrandIndexRow[]>(Prisma.sql`
    ${BRANDS_INDEX_SELECT}
    ORDER BY g.brand_name ASC
  `)
  return brandRows.map(mapBrandRowToMeiliDoc)
}

/** Loads all v0 Meili documents in paginated DB reads (avoids statement timeouts). */
export async function fetchAllV0MeiliDocuments(): Promise<V0MeiliDocument[]> {
  const documents: V0MeiliDocument[] = []
  let offset = 0

  while (true) {
    const batch = await fetchV0MeiliProductDocumentsPage({ offset })
    if (batch.length === 0) break
    documents.push(...batch)
    offset += batch.length
    if (batch.length < V0_MEILI_PRODUCT_FETCH_BATCH) break
  }

  documents.push(...(await fetchV0MeiliBrandDocuments()))
  return documents
}

export function mapDpmatchIndexRowToProductRow(row: DpmatchIndexRow): V0DpmatchProductRow {
  return {
    matchId: row.id,
    dproductsId: null,
    ptproductsId: null,
    mappingStatus: 'APPROVED',
    matchMethod: null,
    normalized: row.normalized,
    dinamikStockCode: row.stock_code,
    dinamikStockName: row.stock_name,
    dinamikBrand: row.brand,
    dinamikPartNo: row.part_no,
    dinamikBarcode1: row.barcode_1,
    dinamikBarcode2: row.barcode_2,
    dinamikBarcode3: row.barcode_3,
    dinamikPrice: row.dinamik_price,
    dinamikStockQty: row.dinamik_stock_qty,
    ptTitle: row.title,
    ptModel: row.model,
    ptRefNo: row.ref_no,
    ptPrice: row.pt_price,
    ptImageUrl: row.image_url,
    ptUrl: null,
    ptManufacturerName: row.manufacturer_name,
    matchedBrandName: row.matched_brand,
    brandLogoUrl: row.brand_logo_url
  }
}
