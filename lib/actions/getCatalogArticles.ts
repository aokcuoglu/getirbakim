'use server'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { SearchHit } from '@/lib/types/search'
import {
  buildCatalogPrice,
  resolveCatalogName
} from '@/lib/catalog/store-view'

export type SortOption = 'popularity' | 'price-asc' | 'price-desc' | 'name'

export interface ArticlesRequestBody {
  categoryName?: string
  searchIds?: number[]
  vehicleId?: number | null
  brands?: string[]
  brandListIds?: number[]
  stockStatuses?: string[]
  page?: number
  limit?: number
  sort?: SortOption
  minPrice?: number
  maxPrice?: number
  includePrice?: boolean
  includeHits?: boolean
  includeTotal?: boolean
  includeFacets?: boolean
}

export interface CatalogArticlesResult {
  hits: SearchHit[]
  totalHits: number | null
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: Record<string, number>
  page: number
  limit: number
  cached: boolean
  source: string
  hasMore: boolean
  debugTimingsMs?: Record<string, number>
}

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 48

type CatalogRow = {
  id: bigint
  part_no: string
  name: string
  slug: string | null
  in_stock: boolean
  total_stock_qty: number
  offer_count: number
  min_selling_price_try: Prisma.Decimal | null
  brand_list_id: number
  category_id: number | null
  primary_image_url: string | null
  created_at: Date
  updated_at: Date
  brand_list: { brand: string; logo_url: string | null }
  part_categories: { id: number; name: string; name_tr: string | null } | null
  product_overrides: { name_override: string | null } | null
}

function rowToSearchHit(row: CatalogRow): SearchHit {
  const price = buildCatalogPrice(row.min_selling_price_try)
  const hasPrice = price.exVat != null
  const inStock = row.in_stock && row.total_stock_qty > 0
  const isPurchasable = hasPrice && inStock

  const availabilityStatus = hasPrice
    ? inStock
      ? 'PURCHASABLE'
      : 'OUT_OF_STOCK'
    : 'REQUEST_PRICE'
  const cta =
    availabilityStatus === 'PURCHASABLE'
      ? 'add_to_cart'
      : availabilityStatus === 'OUT_OF_STOCK'
        ? 'notify_or_request_price'
        : 'request_price'

  const name = resolveCatalogName(row.name, row.product_overrides?.name_override)
  const idStr = row.id.toString()

  return {
    id: idStr,
    name,
    articleLinkId: idStr,
    price: price.exVat != null ? String(price.exVat) : null,
    stockQty: row.total_stock_qty,
    priceSource: hasPrice ? 'real' : 'placeholder',
    isPlaceholderPrice: !hasPrice,
    isPurchasable,
    inBasket: false,
    brandId: row.brand_list_id,
    brandName: row.brand_list.brand,
    brandLogo: row.brand_list.logo_url,
    categoryId: row.part_categories?.id ?? 0,
    categoryName: row.part_categories?.name ?? null,
    categoryNameTr: row.part_categories?.name_tr ?? null,
    oemCodes: [],
    oemBrands: [],
    vehicleTypes: [],
    vehicleIds: [],
    vehicleNames: [],
    formattedCompatibility: [],
    searchableText: '',
    images: row.primary_image_url ? [{ image: row.primary_image_url, thumb: null }] : [],
    properties: [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    sourceType: 'part',
    resolvedPartId: idStr,
    dedupeKey: `catalog:${idStr}`,
    canonicalKey: `catalog:${idStr}`,
    variantCount: 1,
    documentType: 'canonical_part',
    matchStatus: 'APPROVED',
    hasSupplierOffer: row.offer_count > 0,
    offerCount: row.offer_count,
    availabilityStatus,
    cta,
    detailUrl: row.slug ? `/urun/${row.slug}` : null
  }
}

function buildWhere(body: ArticlesRequestBody): Prisma.productsWhereInput {
  const where: Prisma.productsWhereInput = { status: 'ACTIVE', slug: { not: null } }

  if (body.searchIds && body.searchIds.length > 0) {
    where.category_id = { in: body.searchIds }
  }

  if (body.brandListIds && body.brandListIds.length > 0) {
    where.brand_list_id = { in: body.brandListIds }
  } else if (body.brands && body.brands.length > 0) {
    where.brand_list = { brand: { in: body.brands } }
  }

  const stock = body.stockStatuses ?? []
  if (stock.length === 1) {
    if (stock.includes('in-stock')) where.in_stock = true
    else if (stock.includes('on-order')) where.in_stock = false
  }

  if (Number.isFinite(body.minPrice) || Number.isFinite(body.maxPrice)) {
    where.min_selling_price_try = {
      ...(Number.isFinite(body.minPrice) ? { gte: body.minPrice } : {}),
      ...(Number.isFinite(body.maxPrice) ? { lte: body.maxPrice } : {})
    }
  }

  return where
}

function buildOrderBy(
  sort?: SortOption
): Prisma.productsOrderByWithRelationInput[] {
  switch (sort) {
    case 'price-asc':
      return [{ min_selling_price_try: { sort: 'asc', nulls: 'last' } }]
    case 'price-desc':
      return [{ min_selling_price_try: { sort: 'desc', nulls: 'last' } }]
    case 'name':
      return [{ name: 'asc' }]
    default:
      return [{ in_stock: 'desc' }, { offer_count: 'desc' }, { updated_at: 'desc' }]
  }
}

/**
 * Prisma fallback for category listing, sourced from the `catalog` schema.
 * Used when Meilisearch is unavailable/empty. Category browse is limited to
 * catalog products that carry a category (sparse until enrichment expands);
 * uncategorized products remain reachable via search and brand pages.
 */
export async function getCatalogArticles(
  body: ArticlesRequestBody
): Promise<CatalogArticlesResult> {
  const page = Math.max(1, body.page ?? 1)
  const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const offset = (page - 1) * limit

  const where = buildWhere(body)
  const orderBy = buildOrderBy(body.sort)

  const [rows, totalHits] = await Promise.all([
    db.products.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      select: {
        id: true,
        part_no: true,
        name: true,
        slug: true,
        in_stock: true,
        total_stock_qty: true,
        offer_count: true,
        min_selling_price_try: true,
        brand_list_id: true,
        category_id: true,
        primary_image_url: true,
        created_at: true,
        updated_at: true,
        brand_list: { select: { brand: true, logo_url: true } },
        part_categories: { select: { id: true, name: true, name_tr: true } },
        product_overrides: { select: { name_override: true } }
      }
    }),
    body.includeTotal !== false ? db.products.count({ where }) : Promise.resolve(null)
  ])

  const hits = rows.map((r) => rowToSearchHit(r as CatalogRow))

  let brandFacetDistribution: Record<string, number> = {}
  const stockFacetDistribution: Record<string, number> = { 'in-stock': 0, 'on-order': 0 }

  if (body.includeFacets && (body.searchIds?.length || body.brands?.length)) {
    const [brandGroups, inStockCount, total] = await Promise.all([
      db.products.groupBy({
        by: ['brand_list_id'],
        where,
        _count: { _all: true },
        orderBy: { _count: { brand_list_id: 'desc' } },
        take: 50
      }),
      db.products.count({ where: { ...where, in_stock: true } }),
      totalHits ?? db.products.count({ where })
    ])
    const brandIds = brandGroups.map((g) => g.brand_list_id)
    const brands = brandIds.length
      ? await db.brand_list.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, brand: true }
        })
      : []
    const nameById = new Map(brands.map((b) => [b.id, b.brand]))
    brandFacetDistribution = Object.fromEntries(
      brandGroups
        .map((g) => [nameById.get(g.brand_list_id) ?? '', g._count._all] as const)
        .filter(([name]) => name)
    )
    stockFacetDistribution['in-stock'] = inStockCount
    stockFacetDistribution['on-order'] = Math.max(0, total - inStockCount)
  }

  const hasMore = totalHits != null ? offset + hits.length < totalHits : hits.length === limit

  return {
    hits,
    totalHits,
    brandFacetDistribution,
    stockFacetDistribution,
    page,
    limit,
    cached: false,
    source: 'prisma-catalog-fallback',
    hasMore
  }
}
