'use server'

import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import type { SearchHit } from '@/lib/types/search'
import {
  decimalToString,
  REAL_PRICE_EXISTS_WHERE,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'
import { getCategoryMinRealPriceMap } from '@/lib/pricing/public-pricing-db'
import { fetchResolvedSupplierCatalogHits } from '@/lib/catalog/resolved-supplier-items'
import { mergeCatalogHitsPage } from '@/lib/catalog/catalog-hit-merge'

export type SortOption = 'popularity' | 'price-asc' | 'price-desc' | 'name'

export interface ArticlesRequestBody {
  categoryName?: string
  searchIds?: number[]
  vehicleId?: number | null
  brands?: string[]
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
  debugTimingsMs?: Record<string, number>
}

const DEFAULT_LIMIT = 24
const MAX_OEM_CODES = 4
const MAX_PROPERTIES = 4
const MAX_IMAGES = 1
const BRAND_ID_CACHE_TTL_MS = 10 * 60 * 1000
const brandIdCache = new Map<string, { id: number | null; expiresAt: number }>()

function normalizeBody(body: ArticlesRequestBody) {
  return {
    categoryName:
      typeof body.categoryName === 'string' ? body.categoryName : '',
    searchIds: Array.isArray(body.searchIds)
      ? body.searchIds.filter((id) => Number.isInteger(id) && id > 0)
      : [],
    vehicleId:
      typeof body.vehicleId === 'number' && Number.isInteger(body.vehicleId)
        ? body.vehicleId
        : null,
    brands: Array.isArray(body.brands)
      ? Array.from(
          new Set(
            body.brands
              .filter((brand): brand is string => typeof brand === 'string')
              .map((brand) => brand.trim())
              .filter((brand) => brand.length > 0)
          )
        )
      : [],
    stockStatuses: Array.isArray(body.stockStatuses)
      ? body.stockStatuses.filter(
          (status): status is 'in-stock' | 'on-order' =>
            status === 'in-stock' || status === 'on-order'
        )
      : [],
    page:
      typeof body.page === 'number' && body.page > 0
        ? Math.floor(body.page)
        : 1,
    limit:
      typeof body.limit === 'number' && body.limit > 0
        ? Math.min(96, Math.floor(body.limit))
        : DEFAULT_LIMIT,
    sort: body.sort ?? 'popularity',
    minPrice: typeof body.minPrice === 'number' ? body.minPrice : undefined,
    maxPrice: typeof body.maxPrice === 'number' ? body.maxPrice : undefined,
    includePrice: body.includePrice !== false, // Default to true if not specified
    includeHits: body.includeHits !== false,
    includeTotal: body.includeTotal !== false,
    includeFacets: body.includeFacets !== false
  }
}

function buildCategoryNameVariants(categoryName: string): string[] {
  const base = categoryName.trim()
  if (!base) return []

  const values = new Set<string>([base])
  if (base.toLowerCase().endsWith('s')) {
    values.add(base.slice(0, -1))
  } else {
    values.add(`${base}s`)
  }

  return Array.from(values)
}

function buildWhereInput(
  payload: ReturnType<typeof normalizeBody>,
  options?: {
    excludeBrands?: boolean
    excludeStock?: boolean
    brandIds?: number[]
    requireRealPrice?: boolean
  }
): Prisma.partsWhereInput {
  const where: Prisma.partsWhereInput = {}
  const excludeBrands = options?.excludeBrands === true
  const excludeStock = options?.excludeStock === true

  if (payload.searchIds.length > 0) {
    where.category_id = { in: payload.searchIds }
  } else if (payload.categoryName) {
    const names = buildCategoryNameVariants(payload.categoryName)
    where.part_categories = {
      OR: [
        { name: { in: names, mode: 'insensitive' } },
        { name_tr: { in: names, mode: 'insensitive' } }
      ]
    }
  }

  if (payload.vehicleId) {
    where.part_vehicle_types = {
      some: {
        vehicle_type_id: payload.vehicleId
      }
    }
  }

  if (payload.brands.length > 0 && !excludeBrands) {
    const brandIds = options?.brandIds ?? []
    where.brand_id = { in: brandIds }
  }

  if (!excludeStock && payload.stockStatuses.length === 1) {
    if (payload.stockStatuses[0] === 'in-stock') {
      where.part_pricing_inventory = {
        is: {
          supplier_stock_qty: {
            gt: 0
          }
        }
      }
    } else {
      where.OR = [
        {
          part_pricing_inventory: {
            is: null
          }
        },
        {
          part_pricing_inventory: {
            is: {
              supplier_stock_qty: {
                lte: 0
              }
            }
          }
        }
      ]
    }
  }

  if (payload.minPrice !== undefined || payload.maxPrice !== undefined) {
    const priceRange = {
      ...(payload.minPrice !== undefined
        ? { gte: new Prisma.Decimal(payload.minPrice) }
        : {}),
      ...(payload.maxPrice !== undefined
        ? { lte: new Prisma.Decimal(payload.maxPrice) }
        : {})
    } satisfies Prisma.DecimalFilter

    const priceRangeWhere: Prisma.partsWhereInput = {
      OR: [
        {
          part_admin_overrides: {
            is: {
              lock_price: true,
              selling_price_override: priceRange
            }
          }
        },
        {
          part_pricing_inventory: {
            is: {
              computed_selling_price_ex_vat: priceRange
            }
          }
        },
        {
          part_pricing_inventory: {
            is: {
              supplier_price: priceRange
            }
          }
        },
        {
          price: priceRange
        }
      ]
    }

    const existingAnd = where.AND
    if (Array.isArray(existingAnd)) {
      where.AND = [...existingAnd, priceRangeWhere]
    } else if (existingAnd) {
      where.AND = [existingAnd, priceRangeWhere]
    } else {
      where.AND = [priceRangeWhere]
    }
  }

  if (options?.requireRealPrice) {
    const existingAnd = where.AND
    if (Array.isArray(existingAnd)) {
      where.AND = [...existingAnd, REAL_PRICE_EXISTS_WHERE]
    } else if (existingAnd) {
      where.AND = [existingAnd, REAL_PRICE_EXISTS_WHERE]
    } else {
      where.AND = [REAL_PRICE_EXISTS_WHERE]
    }
  }

  return where
}

function buildOrderBy(
  sort: SortOption
): Prisma.partsOrderByWithRelationInput[] {
  switch (sort) {
    case 'price-asc':
      return [{ price: 'asc' }, { id: 'asc' }]
    case 'price-desc':
      return [{ price: 'desc' }, { id: 'desc' }]
    case 'name':
      return [{ name: 'asc' }]
    case 'popularity':
    default:
      return [{ id: 'desc' }]
  }
}

async function resolveBrandIdsCached(brandNames: string[]): Promise<number[]> {
  if (brandNames.length === 0) return []

  const now = Date.now()
  const normalized = brandNames.map((name) => name.trim().toLowerCase())
  const missingKeys: string[] = []

  for (const key of normalized) {
    const cached = brandIdCache.get(key)
    if (!cached || cached.expiresAt <= now) {
      missingKeys.push(key)
    }
  }

  if (missingKeys.length > 0) {
    const rows = await db.part_brands.findMany({
      where: {
        OR: missingKeys.map((brand) => ({
          name: {
            equals: brand,
            mode: 'insensitive'
          }
        }))
      },
      select: { id: true, name: true }
    })

    const foundByKey = new Map(
      rows.map((row) => [row.name.trim().toLowerCase(), row.id])
    )
    const expiresAt = now + BRAND_ID_CACHE_TTL_MS

    for (const key of missingKeys) {
      brandIdCache.set(key, {
        id: foundByKey.get(key) ?? null,
        expiresAt
      })
    }
  }

  const ids = normalized
    .map((key) => brandIdCache.get(key))
    .filter((entry): entry is { id: number; expiresAt: number } =>
      Boolean(entry && entry.id != null)
    )
    .map((entry) => entry.id)

  return Array.from(new Set(ids))
}

function toNumberSafe(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toBigIntSafe(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(Math.trunc(value))
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return BigInt(value)
    }
  } catch {
    return null
  }

  return null
}

function buildRangeSql(
  columnSql: Prisma.Sql,
  minPrice: number | undefined,
  maxPrice: number | undefined
): Prisma.Sql {
  const clauses: Prisma.Sql[] = []

  if (minPrice !== undefined) {
    clauses.push(Prisma.sql`${columnSql} >= ${new Prisma.Decimal(minPrice)}`)
  }

  if (maxPrice !== undefined) {
    clauses.push(Prisma.sql`${columnSql} <= ${new Prisma.Decimal(maxPrice)}`)
  }

  if (clauses.length === 0) return Prisma.sql`TRUE`
  if (clauses.length === 1) return clauses[0]
  return Prisma.sql`(${Prisma.join(clauses, ' AND ')})`
}

function buildDedupWhereSql(
  payload: ReturnType<typeof normalizeBody>,
  options: {
    excludeBrands?: boolean
    excludeStock?: boolean
    brandIds?: number[]
    requireRealPrice?: boolean
  }
): Prisma.Sql {
  const whereClauses: Prisma.Sql[] = []
  const excludeBrands = options.excludeBrands === true
  const excludeStock = options.excludeStock === true
  const realPriceExistsSql = Prisma.sql`
    (
      (COALESCE(o.lock_price, FALSE) = TRUE AND o.selling_price_override IS NOT NULL)
      OR i.computed_selling_price_ex_vat IS NOT NULL
      OR i.supplier_price IS NOT NULL
      OR p.price IS NOT NULL
    )
  `

  if (payload.searchIds.length > 0) {
    whereClauses.push(Prisma.sql`p.category_id IN (${Prisma.join(payload.searchIds)})`)
  } else if (payload.categoryName) {
    const names = buildCategoryNameVariants(payload.categoryName)
    const categoryNameClauses = names.map((name) => {
      return Prisma.sql`(
        lower(c.name) = lower(${name})
        OR lower(COALESCE(c.name_tr, '')) = lower(${name})
      )`
    })

    if (categoryNameClauses.length > 0) {
      whereClauses.push(Prisma.sql`(${Prisma.join(categoryNameClauses, ' OR ')})`)
    }
  }

  if (payload.vehicleId) {
    whereClauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM part_vehicle_types pvt
        WHERE pvt.part_id = p.id
          AND pvt.vehicle_type_id = ${payload.vehicleId}
      )
    `)
  }

  if (payload.brands.length > 0 && !excludeBrands) {
    const brandIds = options.brandIds ?? []
    if (brandIds.length === 0) {
      whereClauses.push(Prisma.sql`FALSE`)
    } else {
      whereClauses.push(Prisma.sql`p.brand_id IN (${Prisma.join(brandIds)})`)
    }
  }

  if (!excludeStock && payload.stockStatuses.length === 1) {
    if (payload.stockStatuses[0] === 'in-stock') {
      whereClauses.push(Prisma.sql`COALESCE(i.supplier_stock_qty, 0) > 0`)
    } else {
      whereClauses.push(Prisma.sql`COALESCE(i.supplier_stock_qty, 0) <= 0`)
    }
  }

  if (payload.minPrice !== undefined || payload.maxPrice !== undefined) {
    const overrideRangeSql = buildRangeSql(
      Prisma.sql`o.selling_price_override`,
      payload.minPrice,
      payload.maxPrice
    )
    const computedRangeSql = buildRangeSql(
      Prisma.sql`i.computed_selling_price_ex_vat`,
      payload.minPrice,
      payload.maxPrice
    )
    const supplierRangeSql = buildRangeSql(
      Prisma.sql`i.supplier_price`,
      payload.minPrice,
      payload.maxPrice
    )
    const baseRangeSql = buildRangeSql(
      Prisma.sql`p.price`,
      payload.minPrice,
      payload.maxPrice
    )

    whereClauses.push(Prisma.sql`
      (
        (
          COALESCE(o.lock_price, FALSE) = TRUE
          AND o.selling_price_override IS NOT NULL
          AND ${overrideRangeSql}
        )
        OR (i.computed_selling_price_ex_vat IS NOT NULL AND ${computedRangeSql})
        OR (i.supplier_price IS NOT NULL AND ${supplierRangeSql})
        OR (p.price IS NOT NULL AND ${baseRangeSql})
      )
    `)
  }

  if (options.requireRealPrice) {
    whereClauses.push(realPriceExistsSql)
  }

  if (whereClauses.length === 0) return Prisma.sql`TRUE`
  return Prisma.sql`${Prisma.join(whereClauses, ' AND ')}`
}

function buildDedupCteSql(whereSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH base_raw AS (
      SELECT
        p.id,
        p.tecdoc_article_id,
        p.article_link_id,
        p.in_basket,
        p.brand_id,
        p.category_id,
        p.name,
        p.price,
        p.created_at,
        p.updated_at,
        i.supplier_price,
        i.computed_selling_price_ex_vat,
        i.supplier_stock_qty,
        i.reserved_stock_qty,
        o.lock_price,
        o.selling_price_override,
        lower(regexp_replace(TRIM(BOTH FROM replace(p.name, chr(160), ' ')), '\\s+', ' ', 'g')) AS normalized_name
      FROM parts p
      LEFT JOIN part_categories c ON c.id = p.category_id
      LEFT JOIN part_pricing_inventory i ON i.part_id = p.id
      LEFT JOIN part_admin_overrides o ON o.part_id = p.id
      WHERE ${whereSql}
    ),
    base AS (
      SELECT
        base_raw.*,
        CASE
          WHEN base_raw.tecdoc_article_id IS NOT NULL THEN
            concat(
              base_raw.tecdoc_article_id::text,
              '|',
              base_raw.brand_id::text,
              '|',
              base_raw.category_id::text,
              '|',
              base_raw.normalized_name
            )
          ELSE concat('id|', base_raw.id::text)
        END AS dedupe_key,
        CASE WHEN COALESCE(base_raw.supplier_stock_qty, 0) > 0 THEN 1 ELSE 0 END AS in_stock_rank,
        CASE
          WHEN (
            (COALESCE(base_raw.lock_price, FALSE) = TRUE AND base_raw.selling_price_override IS NOT NULL)
            OR base_raw.computed_selling_price_ex_vat IS NOT NULL
            OR base_raw.supplier_price IS NOT NULL
            OR base_raw.price IS NOT NULL
          ) THEN 1
          ELSE 0
        END AS real_price_rank
      FROM base_raw
    ),
    ranked AS (
      SELECT
        base.*,
        COUNT(*) OVER (PARTITION BY base.dedupe_key)::int AS variant_count,
        ROW_NUMBER() OVER (
          PARTITION BY base.dedupe_key
          ORDER BY
            base.in_stock_rank DESC,
            base.real_price_rank DESC,
            base.updated_at DESC,
            base.id DESC
        ) AS rn
      FROM base
    ),
    deduped AS (
      SELECT * FROM ranked WHERE rn = 1
    )
  `
}

function buildDedupOrderSql(sort: SortOption): Prisma.Sql {
  switch (sort) {
    case 'price-asc':
      return Prisma.sql`ORDER BY d.price ASC NULLS LAST, d.id ASC`
    case 'price-desc':
      return Prisma.sql`ORDER BY d.price DESC NULLS LAST, d.id DESC`
    case 'name':
      return Prisma.sql`ORDER BY d.name ASC, d.id DESC`
    case 'popularity':
    default:
      return Prisma.sql`ORDER BY d.id DESC`
  }
}

export async function getCatalogArticles(
  rawPayload: ArticlesRequestBody
): Promise<CatalogArticlesResult> {
  const requestStart = performance.now()
  const timingsMs: Record<string, number> = {}
  const mark = (key: string, start: number) => {
    timingsMs[key] = Number((performance.now() - start).toFixed(2))
  }

  const payload = normalizeBody(rawPayload)
  const isTimingDebug = process.env.NODE_ENV !== 'production'
  const shouldUseRedisCache = !(
    payload.includeHits &&
    !payload.includeFacets &&
    !payload.includeTotal
  )
  const cacheKey = `catalog:articles:v3:${crypto
    .createHash('md5')
    .update(JSON.stringify(payload))
    .digest('hex')}`

  if (shouldUseRedisCache) {
    const cacheLookupStart = performance.now()
    const cached = await getFromCache<unknown>(cacheKey)
    mark('cacheLookup', cacheLookupStart)
    if (cached) {
      const cachedResult = {
        ...(cached as Record<string, unknown>),
        cached: true,
        ...(isTimingDebug
          ? {
              debugTimingsMs: {
                ...timingsMs,
                total: Number((performance.now() - requestStart).toFixed(2))
              }
            }
          : {})
      } as CatalogArticlesResult
      return cachedResult
    }
  } else {
    timingsMs.cacheLookup = 0
  }

  const brandResolveStart = performance.now()
  const resolvedBrandIds =
    payload.brands.length > 0 ? await resolveBrandIdsCached(payload.brands) : []
  mark('brandResolve', brandResolveStart)

  const requireRealPrice =
    payload.sort === 'price-asc' ||
    payload.sort === 'price-desc' ||
    payload.minPrice !== undefined ||
    payload.maxPrice !== undefined

  const useQueryLevelDedupe = payload.vehicleId == null

  const select = {
    id: true,
    tecdoc_article_id: true,
    article_link_id: true,
    in_basket: true,
    brand_id: true,
    category_id: true,
    name: true,
    price: true,
    created_at: true,
    updated_at: true,
    part_brands: {
      select: {
        name: true,
        logo_url: true
      }
    },
    part_categories: {
      select: {
        name: true,
        name_tr: true
      }
    },
    part_images: {
      take: MAX_IMAGES,
      select: {
        image: true,
        thumb: true
      }
    },
    part_properties: {
      take: MAX_PROPERTIES,
      select: {
        key: true,
        value: true
      }
    },
    part_oens: {
      take: MAX_OEM_CODES,
      select: {
        code: true,
        brand: true
      }
    },
    part_pricing_inventory: {
      select: {
        supplier_price: true,
        computed_selling_price_ex_vat: true,
        supplier_stock_qty: true,
        reserved_stock_qty: true
      }
    },
    part_admin_overrides: {
      select: {
        lock_price: true,
        selling_price_override: true
      }
    }
  } satisfies Prisma.partsSelect
  type PartRow = Prisma.partsGetPayload<{ select: typeof select }>

  const offset = (payload.page - 1) * payload.limit
  let totalHits: number | null = null
  let inStockCount = 0
  let onOrderCount = 0
  let rawBrandGroups: Array<{ brand_id: number; count: number }> = []
  const variantMetaByPartId = new Map<
    string,
    { variantCount: number; dedupeKey: string }
  >()
  let parts: PartRow[] = []

  if (useQueryLevelDedupe) {
    const dedupeWhere = buildDedupWhereSql(payload, {
      brandIds: resolvedBrandIds,
      requireRealPrice
    })
    const dedupeWhereWithoutBrands = buildDedupWhereSql(payload, {
      excludeBrands: true,
      requireRealPrice
    })
    const dedupeWhereWithoutBrandsAndStock = buildDedupWhereSql(payload, {
      excludeBrands: true,
      excludeStock: true,
      requireRealPrice
    })

    // Run totalCount, facetCounts, and hits CTE in parallel
    const parallelStart = performance.now()

    const totalPromise = payload.includeTotal
      ? db.$queryRaw<Array<{ count: bigint | number }>>(
          Prisma.sql`
            ${buildDedupCteSql(dedupeWhere)}
            SELECT COUNT(*)::bigint AS count
            FROM deduped
          `
        )
      : Promise.resolve(null)

    const brandFacetPromise = payload.includeFacets
      ? db.$queryRaw<Array<{ brand_id: number; count: bigint | number }>>(
          Prisma.sql`
            ${buildDedupCteSql(dedupeWhereWithoutBrands)}
            SELECT d.brand_id, COUNT(*)::bigint AS count
            FROM deduped d
            GROUP BY d.brand_id
          `
        )
      : Promise.resolve(null)

    const stockFacetPromise = payload.includeFacets
      ? db.$queryRaw<
          Array<{ in_stock_count: bigint | number; on_order_count: bigint | number }>
        >(
          Prisma.sql`
            ${buildDedupCteSql(dedupeWhereWithoutBrandsAndStock)}
            SELECT
              COALESCE(SUM(CASE WHEN COALESCE(d.supplier_stock_qty, 0) > 0 THEN 1 ELSE 0 END), 0)::bigint AS in_stock_count,
              COALESCE(SUM(CASE WHEN COALESCE(d.supplier_stock_qty, 0) <= 0 THEN 1 ELSE 0 END), 0)::bigint AS on_order_count
            FROM deduped d
          `
        )
      : Promise.resolve(null)

    const hitsCtePromise = payload.includeHits
      ? db.$queryRaw<
          Array<{ id: bigint | number | string; variant_count: number; dedupe_key: string }>
        >(
          Prisma.sql`
            ${buildDedupCteSql(dedupeWhere)}
            SELECT d.id, d.variant_count, d.dedupe_key
            FROM deduped d
            ${buildDedupOrderSql(payload.sort)}
            OFFSET ${offset}
            LIMIT ${payload.limit}
          `
        )
      : Promise.resolve(null)

    const [totalRows, brandRows, stockRows, dedupedRows] = await Promise.all([
      totalPromise,
      brandFacetPromise,
      stockFacetPromise,
      hitsCtePromise
    ])
    mark('parallelQueries', parallelStart)

    if (totalRows) {
      totalHits = toNumberSafe(totalRows[0]?.count)
    }

    if (brandRows) {
      rawBrandGroups = brandRows.map((row) => ({
        brand_id: row.brand_id,
        count: toNumberSafe(row.count)
      }))
    }
    if (stockRows) {
      inStockCount = toNumberSafe(stockRows[0]?.in_stock_count)
      onOrderCount = toNumberSafe(stockRows[0]?.on_order_count)
    }

    const hitsStart = performance.now()
    if (dedupedRows) {
      const orderedIds: bigint[] = []
      const orderedIdKeys: string[] = []

      for (const row of dedupedRows) {
        const id = toBigIntSafe(row.id)
        if (id == null) continue

        orderedIds.push(id)
        orderedIdKeys.push(id.toString())
        variantMetaByPartId.set(id.toString(), {
          variantCount: toNumberSafe(row.variant_count) || 1,
          dedupeKey: row.dedupe_key
        })
      }

      if (orderedIds.length > 0) {
        const fetchedParts = await db.parts.findMany({
          where: { id: { in: orderedIds } },
          select
        })
        const partById = new Map(
          fetchedParts.map((part) => [part.id.toString(), part] as const)
        )
        parts = orderedIdKeys
          .map((key) => partById.get(key))
          .filter((part): part is PartRow => Boolean(part))
      }
    }
    mark('hitsQuery', hitsStart)
  } else {
    const where = buildWhereInput(payload, {
      brandIds: resolvedBrandIds,
      requireRealPrice
    })
    const whereWithoutBrands = buildWhereInput(payload, {
      excludeBrands: true,
      requireRealPrice
    })
    const whereWithoutBrandsAndStock = buildWhereInput(payload, {
      excludeBrands: true,
      excludeStock: true,
      requireRealPrice
    })

    const totalStart = performance.now()
    totalHits = payload.includeTotal ? await db.parts.count({ where }) : null
    mark('totalCount', totalStart)

    const facetsStart = performance.now()
    if (payload.includeFacets) {
      const [brandGroups, inStock, onOrder] = await Promise.all([
        db.parts.groupBy({
          by: ['brand_id'],
          where: whereWithoutBrands,
          _count: { _all: true }
        }),
        db.parts.count({
          where: {
            ...whereWithoutBrandsAndStock,
            part_pricing_inventory: {
              is: {
                supplier_stock_qty: {
                  gt: 0
                }
              }
            }
          }
        }),
        db.parts.count({
          where: {
            ...whereWithoutBrandsAndStock,
            OR: [
              {
                part_pricing_inventory: {
                  is: null
                }
              },
              {
                part_pricing_inventory: {
                  is: {
                    supplier_stock_qty: {
                      lte: 0
                    }
                  }
                }
              }
            ]
          }
        })
      ])

      rawBrandGroups = brandGroups.map((group) => ({
        brand_id: group.brand_id,
        count: group._count._all
      }))
      inStockCount = inStock
      onOrderCount = onOrder
    }
    mark('facetCounts', facetsStart)

    const hitsStart = performance.now()
    if (payload.includeHits) {
      const orderBy = buildOrderBy(payload.sort)
      parts = await db.parts.findMany({
        where,
        orderBy,
        skip: offset,
        take: payload.limit,
        select
      })
    }
    mark('hitsQuery', hitsStart)
  }

  const missingTecdocArticleIds = Array.from(
    new Set(
      parts
        .filter((part) => !resolveRealPriceExVat(part))
        .map((part) => part.tecdoc_article_id)
        .filter((id): id is bigint => typeof id === 'bigint' && id > BigInt(0))
    )
  )

  const fallbackPriceByTecdocId = new Map<bigint, Prisma.Decimal>()

  const fallbackLookupStart = performance.now()
  if (missingTecdocArticleIds.length > 0) {
    const siblingParts = await db.parts.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                tecdoc_article_id: {
                  in: missingTecdocArticleIds
                }
              },
              {
                id: {
                  in: missingTecdocArticleIds
                }
              }
            ]
          },
          REAL_PRICE_EXISTS_WHERE
        ]
      },
      select: {
        id: true,
        tecdoc_article_id: true,
        price: true,
        part_pricing_inventory: {
          select: {
            supplier_price: true,
            computed_selling_price_ex_vat: true
          }
        },
        part_admin_overrides: {
          select: {
            lock_price: true,
            selling_price_override: true
          }
        }
      },
      orderBy: [{ updated_at: 'desc' }]
    })

    for (const siblingPart of siblingParts) {
      const fallbackPrice = resolveRealPriceExVat(siblingPart)
      if (!fallbackPrice) continue

      const tecdocId = siblingPart.tecdoc_article_id
      if (tecdocId != null && !fallbackPriceByTecdocId.has(tecdocId)) {
        fallbackPriceByTecdocId.set(tecdocId, fallbackPrice)
      }

      if (!fallbackPriceByTecdocId.has(siblingPart.id)) {
        fallbackPriceByTecdocId.set(siblingPart.id, fallbackPrice)
      }
    }
  }
  mark('fallbackPriceLookup', fallbackLookupStart)

  const categoryMinPriceMap = await getCategoryMinRealPriceMap(
    Array.from(new Set(parts.map((part) => part.category_id)))
  )

  const brandIds = rawBrandGroups.map((row) => row.brand_id)
  const brands =
    payload.includeFacets && brandIds.length > 0
      ? await db.part_brands.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, name: true }
        })
      : []
  const brandNameById = new Map(brands.map((brand) => [brand.id, brand.name]))

  const brandFacetDistribution = payload.includeFacets
    ? Object.fromEntries(
        rawBrandGroups
          .map((group) => {
            const name = brandNameById.get(group.brand_id)
            if (!name) return null
            return [name, group.count] as const
          })
          .filter((entry): entry is readonly [string, number] => entry !== null)
      )
    : {}

  const partHits: SearchHit[] = parts.map((part) => {
    const variantMeta = variantMetaByPartId.get(part.id.toString())
    const tecdocId = part.tecdoc_article_id
    const fallbackRealPrice =
      tecdocId != null ? fallbackPriceByTecdocId.get(tecdocId) : null
    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat: resolveRealPriceExVat(part) ?? fallbackRealPrice ?? null,
      categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
      stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    return {
      id: part.id.toString(),
      name: part.name,
      articleLinkId: part.article_link_id.toString(),
      dedupeKey: variantMeta?.dedupeKey,
      variantCount: variantMeta?.variantCount,
      price: payload.includePrice ? decimalToString(pricing.resolvedPriceExVat) : null,
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable,
      inBasket: part.in_basket,
      brandId: part.brand_id,
      brandName: part.part_brands.name,
      brandLogo: part.part_brands.logo_url,
      categoryId: part.category_id,
      categoryName: part.part_categories.name,
      categoryNameTr: part.part_categories.name_tr,
      oemCodes: part.part_oens.map((item) => item.code),
      oemBrands: part.part_oens.map((item) => item.brand),
      vehicleTypes: [],
      vehicleIds: [],
      vehicleNames: [],
      formattedCompatibility: [],
      searchableText: part.name,
      images: part.part_images.map((image) => ({
        image: image.image,
        thumb: image.thumb
      })),
      properties: part.part_properties.map((prop) => ({
        key: prop.key,
        value: prop.value,
        key_tr: null,
        value_tr: null
      })),
      createdAt: part.created_at.toISOString(),
      updatedAt: part.updated_at.toISOString(),
      sourceType: 'part' as const,
      resolvedPartId: part.id.toString(),
      canonicalKey: `part:${part.id.toString()}`,
      rankBucket: 1
    } satisfies SearchHit
  })

  let hits = partHits

  const shouldMergeSuppliers =
    payload.includeHits && process.env.ENABLE_SUPPLIER_MERGE === 'true'

  if (shouldMergeSuppliers) {
    const supplierMergeStart = performance.now()
    const supplierResult = await fetchResolvedSupplierCatalogHits({
      categoryName: payload.categoryName,
      searchIds: payload.searchIds,
      vehicleId: payload.vehicleId,
      brandIds: resolvedBrandIds,
      stockStatuses: payload.stockStatuses,
      minPrice: payload.minPrice,
      maxPrice: payload.maxPrice,
      sort: payload.sort,
      page: payload.page,
      limit: Math.max(payload.limit, Math.min(payload.limit * 3, 192)),
      includeTotal: false
    })

    hits = mergeCatalogHitsPage({
      partHits,
      supplierHits: supplierResult.hits,
      sort: payload.sort,
      limit: payload.limit
    })
    mark('supplierMerge', supplierMergeStart)
  } else {
    timingsMs.supplierMerge = 0
  }

  const result: CatalogArticlesResult = {
    hits,
    totalHits,
    brandFacetDistribution,
    stockFacetDistribution: payload.includeFacets
      ? {
          'in-stock': inStockCount,
          'on-order': onOrderCount
        }
      : {},
    page: payload.page,
    limit: payload.limit,
    cached: false,
    source: useQueryLevelDedupe
      ? 'prisma-fallback-deduped+resolved-supplier'
      : 'prisma-fallback+resolved-supplier'
  }

  if (shouldUseRedisCache) {
    const cacheSetStart = performance.now()
    await setCache(cacheKey, result, 60)
    mark('cacheSet', cacheSetStart)
  } else {
    timingsMs.cacheSet = 0
  }

  if (isTimingDebug) {
    timingsMs.total = Number((performance.now() - requestStart).toFixed(2))
    console.info('[getCatalogArticles] timings (ms):', timingsMs)
    result.debugTimingsMs = timingsMs
  }

  return result
}
