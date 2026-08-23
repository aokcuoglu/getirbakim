import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  buildCatalogPrice,
  resolveCatalogName
} from '@/lib/catalog/store-view'
import { isExactCodeQuery, normalizeCode } from '@/lib/matching/code-normalization'
import type { SearchHit } from '@/lib/types/search'

export type CatalogSearchInput = {
  query?: string
  brands?: string[]
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  vehicleIds?: number[]
  page?: number
  limit?: number
  sort?: string
}

type CatalogRow = {
  id: bigint
  part_no: string
  name: string
  slug: string | null
  in_stock: boolean
  total_stock_qty: number
  offer_count: number
  min_selling_price_try: Prisma.Decimal | null
  brand_id: number
  category_id: number | null
  primary_image_url: string | null
  created_at: Date
  updated_at: Date
  brand: { brand: string; logo_url: string | null }
  category: { id: number; name: string; name_tr: string | null } | null
  product_overrides: { name_override: string | null } | null
}

const productSelect = {
  id: true,
  part_no: true,
  name: true,
  slug: true,
  in_stock: true,
  total_stock_qty: true,
  offer_count: true,
  min_selling_price_try: true,
  brand_id: true,
  category_id: true,
  primary_image_url: true,
  created_at: true,
  updated_at: true,
  brand: { select: { brand: true, logo_url: true } },
  category: { select: { id: true, name: true, name_tr: true } },
  product_overrides: { select: { name_override: true } }
} satisfies Prisma.productsSelect

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
    brandId: row.brand_id,
    brandName: row.brand.brand,
    brandLogo: row.brand.logo_url,
    categoryId: row.category?.id ?? 0,
    categoryName: row.category?.name ?? null,
    categoryNameTr: row.category?.name_tr ?? null,
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

function textFilter(query: string): Prisma.productsWhereInput | undefined {
  const q = query.trim()
  if (q.length < 2) return undefined
  const code = normalizeCode(q)
  if (isExactCodeQuery(q) && code) {
    return {
      OR: [
        { part_no_norm: { startsWith: code } },
        { product_oems: { some: { code_norm: { startsWith: code } } } }
      ]
    }
  }
  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { product_overrides: { is: { name_override: { contains: q, mode: 'insensitive' } } } },
      { brand: { is: { brand: { contains: q, mode: 'insensitive' } } } },
      ...(code ? [{ part_no_norm: { startsWith: code } }] : [])
    ]
  }
}

function buildWhere(
  input: CatalogSearchInput,
  opts: { omitBrands?: boolean; omitCategories?: boolean } = {}
): Prisma.productsWhereInput {
  const where: Prisma.productsWhereInput = { status: 'ACTIVE', slug: { not: null } }
  const and: Prisma.productsWhereInput[] = []
  const text = textFilter(input.query ?? '')
  if (text) and.push(text)

  if (!opts.omitBrands && input.brands && input.brands.length > 0) {
    and.push({ brand: { brand: { in: input.brands } } })
  }
  if (!opts.omitCategories && input.categories && input.categories.length > 0) {
    and.push({ category: { name: { in: input.categories } } })
  }
  if (Number.isFinite(input.minPrice) || Number.isFinite(input.maxPrice)) {
    where.min_selling_price_try = {
      ...(Number.isFinite(input.minPrice) ? { gte: input.minPrice } : {}),
      ...(Number.isFinite(input.maxPrice) ? { lte: input.maxPrice } : {})
    }
  }
  if (input.vehicleIds && input.vehicleIds.length > 0) {
    where.product_vehicle_types = {
      some: { vehicle_type_id: { in: input.vehicleIds } }
    }
  }
  if (and.length > 0) where.AND = and
  return where
}

function buildOrderBy(sort?: string): Prisma.productsOrderByWithRelationInput[] {
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
 * Storefront faceted search over `catalog.products`.
 * Payload shape matches `hooks/use-search.ts` (multi-search: hits + brand + category facets).
 */
export async function runCatalogSearch(input: CatalogSearchInput) {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 24), 48)
  const offset = (page - 1) * limit

  const mainWhere = buildWhere(input)
  const brandFacetWhere = buildWhere(input, { omitBrands: true })
  const categoryFacetWhere = buildWhere(input, { omitCategories: true })

  const [rows, totalHits, brandGroups, categoryGroups] = await Promise.all([
    db.products.findMany({
      where: mainWhere,
      orderBy: buildOrderBy(input.sort),
      skip: offset,
      take: limit,
      select: productSelect
    }),
    db.products.count({ where: mainWhere }),
    db.products.groupBy({
      by: ['brand_id'],
      where: brandFacetWhere,
      _count: { _all: true },
      orderBy: { _count: { brand_id: 'desc' } },
      take: 80
    }),
    db.products.groupBy({
      by: ['category_id'],
      where: categoryFacetWhere,
      _count: { _all: true },
      orderBy: { _count: { category_id: 'desc' } },
      take: 80
    })
  ])

  const brandIds = brandGroups.map((g) => g.brand_id)
  const categoryIds = categoryGroups
    .map((g) => g.category_id)
    .filter((id): id is number => id != null)

  const [brands, categories] = await Promise.all([
    brandIds.length
      ? db.brands.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, brand: true }
        })
      : Promise.resolve([]),
    categoryIds.length
      ? db.part_categories.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([])
  ])

  const brandNameById = new Map(brands.map((b) => [b.id, b.brand]))
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))

  const brandName: Record<string, number> = {}
  for (const g of brandGroups) {
    const name = brandNameById.get(g.brand_id)
    if (name) brandName[name] = g._count._all
  }
  const categoryName: Record<string, number> = {}
  for (const g of categoryGroups) {
    if (g.category_id == null) continue
    const name = categoryNameById.get(g.category_id)
    if (name) categoryName[name] = g._count._all
  }

  const hits = rows.map((r) => rowToSearchHit(r as unknown as CatalogRow))

  return {
    results: [
      { hits, estimatedTotalHits: totalHits },
      { facetDistribution: { brandName } },
      { facetDistribution: { categoryName } }
    ]
  }
}
