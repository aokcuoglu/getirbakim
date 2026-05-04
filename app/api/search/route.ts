import { NextRequest } from 'next/server'
import { getFromCache, setCache } from '@/lib/redis'
import {
  getMeiliClient,
  isMeiliUnavailableError,
  PARTS_INDEX
} from '@/lib/meilisearch'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { z } from 'zod'
import type { SearchHit } from '@/lib/types/search'
import {
  decimalToString,
  REAL_PRICE_EXISTS_WHERE,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'
import { getCategoryMinRealPriceMap } from '@/lib/pricing/public-pricing-db'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import {
  buildHybridTokenBundles,
  scoreHybridDocument,
  type HybridScore
} from '@/lib/search/hybrid-search'
import { fetchResolvedSupplierCatalogHits } from '@/lib/catalog/resolved-supplier-items'
import {
  mergeCatalogHitsPage,
  type CatalogHitSortOption
} from '@/lib/catalog/catalog-hit-merge'

type SearchFiltersPayload = {
  brands?: string[]
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  brandName?: string
  categoryName?: string
  brandId?: number
  categoryId?: number
  vehicleIds?: number[]
  inBasket?: boolean
}

const searchFiltersSchema = z
  .object({
    brands: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    brandName: z.string().optional(),
    categoryName: z.string().optional(),
    brandId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    vehicleIds: z.array(z.number().int().positive()).optional(),
    inBasket: z.boolean().optional()
  })
  .passthrough()

const searchRequestSchema = z
  .object({
    query: z.string().default(''),
    filters: searchFiltersSchema.default({}),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(120).default(24),
    sort: z.string().optional(),
    multiSearch: z.boolean().default(false)
  })
  .passthrough()

/**
 * Server-side search API with Redis caching
 * 
 * This API route provides:
 * - Redis caching for search results (5 min TTL)
 * - Server-side Meilisearch access (secure API keys)
 * - Multi-search support for disjunctive faceting
 * - Rate limiting ready
 * 
 * Usage:
 * POST /api/search
 * Body: { 
 *   query: string, 
 *   filters: object, 
 *   page: number, 
 *   limit: number,
 *   sort?: string,
 *   multiSearch?: boolean  // If true, returns multi-search results with facets
 * }
 */
export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:search',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  let body: z.infer<typeof searchRequestSchema> = {
    query: '',
    filters: {},
    page: 1,
    limit: 24,
    multiSearch: false
  }

  try {
    const requestStart = performance.now()
    const timingsMs: Record<string, number> = {}
    const mark = (key: string, start: number) => {
      timingsMs[key] = Number((performance.now() - start).toFixed(2))
    }
    const isTimingDebug = process.env.NODE_ENV !== 'production'

    const parsedBody = await parseJsonBody(request, searchRequestSchema, context)
    if (!parsedBody.success) return parsedBody.response

    body = parsedBody.data
    const { 
      query = '', 
      filters = {}, 
      page = 1, 
      limit = 24, 
      sort,
      multiSearch = false 
    } = body
    const requireRealPrice = isPriceSensitiveSearch({ sort, filters })

    // Create cache key from search parameters (include multiSearch flag)
    const cacheKeyData = JSON.stringify({ query, filters, page, limit, sort, multiSearch })
    const cacheKeyHash = crypto
      .createHash('md5')
      .update(cacheKeyData)
      .digest('hex')
    const cacheKey = `meilisearch:search:v3:${cacheKeyHash}`

    // Try Redis cache first
    const cacheLookupStart = performance.now()
    const cached = await getFromCache(cacheKey)
    mark('cacheLookup', cacheLookupStart)
    if (cached) {
      const res = successResponse({
        ...cached,
        cached: true
      }, context)
      res.headers.set('X-Cache', 'HIT')
      res.headers.set('Server-Timing', `redis;dur=${timingsMs.cacheLookup}`)
      return res
    }

    const shouldUsePrismaFallback = process.env.MEILI_ENABLED !== 'true'
    if (shouldUsePrismaFallback) {
      const prismaStart = performance.now()
      const fallback = await runPrismaSearchFallback({
        query,
        filters,
        page,
        limit,
        sort,
        multiSearch
      })
      mark('prismaFallback', prismaStart)

      const cacheSetStart = performance.now()
      await setCache(cacheKey, fallback, 120).catch(() => {})
      mark('cacheSet', cacheSetStart)

      const res = successResponse({
        ...fallback,
        degraded: true,
        source: 'search-prisma-fallback'
      }, context)
      res.headers.set('X-Cache', 'MISS')
      res.headers.set(
        'Server-Timing',
        `redis;dur=${timingsMs.cacheLookup},prisma;dur=${timingsMs.prismaFallback},redisSet;dur=${timingsMs.cacheSet},total;dur=${Number((performance.now() - requestStart).toFixed(2))}`
      )
      if (isTimingDebug) {
        console.info('[search] timings (ms):', {
          ...timingsMs,
          total: Number((performance.now() - requestStart).toFixed(2))
        })
      }
      return res
    }

    const client = getMeiliClient()

    // Multi-search mode (for disjunctive faceting)
    if (multiSearch) {
      const meiliStart = performance.now()
      const mainFilter = buildMeilisearchFilter(filters, undefined, {
        requireRealPrice
      })
      const sortAttr = getMeiliSort(sort)

      const queries = [
        // Main query - returns hits with all filters applied
        {
          indexUid: PARTS_INDEX,
          q: query,
          filter: mainFilter || undefined,
          limit,
          offset: (page - 1) * limit,
          sort: sortAttr.length > 0 ? sortAttr : undefined,
          facets: ['brandName', 'categoryName'],
          attributesToHighlight: ['name', 'brandName']
        },
        // Brand facet query - exclude brand filter to get all brand counts
        {
          indexUid: PARTS_INDEX,
          q: query,
          filter:
            buildMeilisearchFilter(filters, 'brandName', {
              requireRealPrice
            }) || undefined,
          limit: 0, // We only need facets, not hits
          facets: ['brandName']
        },
        // Category facet query - exclude category filter
        {
          indexUid: PARTS_INDEX,
          q: query,
          filter:
            buildMeilisearchFilter(filters, 'categoryName', {
              requireRealPrice
            }) || undefined,
          limit: 0,
          facets: ['categoryName']
        }
      ]

      const response = await client.multiSearch({ queries })
      mark('meili', meiliStart)
      const enrichedMainHits = await enrichMeiliHitsWithPublicPricing(
        response.results[0]?.hits ?? []
      )
      const filteredMainHits = requireRealPrice
        ? enrichedMainHits.filter((hit) => hit.priceSource === 'real')
        : enrichedMainHits

      const result = {
        results: [
          {
            ...response.results[0],
            hits: filteredMainHits
          },
          response.results[1],
          response.results[2]
        ],
        cached: false
      }

      // Cache in Redis (5 minutes)
      const cacheSetStart = performance.now()
      await setCache(cacheKey, result, 300).catch((err) => {
        console.error('Failed to cache search results:', err)
      })
      mark('cacheSet', cacheSetStart)

      const res = successResponse(result, context)
      res.headers.set('X-Cache', 'MISS')
      res.headers.set(
        'Server-Timing',
        `redis;dur=${timingsMs.cacheLookup},meili;dur=${timingsMs.meili},redisSet;dur=${timingsMs.cacheSet},total;dur=${Number((performance.now() - requestStart).toFixed(2))}`
      )
      if (isTimingDebug) {
        console.info('[search] timings (ms):', {
          ...timingsMs,
          total: Number((performance.now() - requestStart).toFixed(2))
        })
      }
      return res
    }

    // Single search mode (backward compatibility)
    const meiliFilter = buildMeilisearchFilter(filters, undefined, {
      requireRealPrice
    })
    const index = client.index(PARTS_INDEX)

    const searchOptions: any = {
      filter: meiliFilter || undefined,
      limit,
      offset: (page - 1) * limit,
      facets: ['brandName', 'categoryName'],
      attributesToHighlight: ['name', 'brandName']
    }

    // Add sort if provided
    if (sort) {
      const sortAttr = getMeiliSort(sort)
      if (sortAttr.length > 0) {
        searchOptions.sort = sortAttr
      }
    }

    const meiliStart = performance.now()
    const results = await index.search(query, searchOptions)
    mark('meili', meiliStart)
    const enrichedHits = await enrichMeiliHitsWithPublicPricing(results.hits)
    const filteredHits = requireRealPrice
      ? enrichedHits.filter((hit) => hit.priceSource === 'real')
      : enrichedHits

    // Transform results
    const response = {
      hits: filteredHits,
      totalHits: results.estimatedTotalHits || 0,
      facetDistribution: results.facetDistribution,
      processingTimeMs: results.processingTimeMs,
      query: results.query,
      cached: false
    }

    // Cache in Redis (5 minutes)
    const cacheSetStart = performance.now()
    await setCache(cacheKey, response, 300).catch((err) => {
      console.error('Failed to cache search results:', err)
      // Don't fail the request if caching fails
    })
    mark('cacheSet', cacheSetStart)

    const res = successResponse(response, context)
    res.headers.set('X-Cache', 'MISS')
    res.headers.set(
      'Server-Timing',
      `redis;dur=${timingsMs.cacheLookup},meili;dur=${timingsMs.meili},redisSet;dur=${timingsMs.cacheSet},total;dur=${Number((performance.now() - requestStart).toFixed(2))}`
    )
    if (isTimingDebug) {
      console.info('[search] timings (ms):', {
        ...timingsMs,
        total: Number((performance.now() - requestStart).toFixed(2))
      })
    }
    return res
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (isMeiliUnavailableError(error)) {
      const {
        query = '',
        filters = {},
        page = 1,
        limit = 24,
        sort,
        multiSearch = false
      } = body

      const fallback = await runPrismaSearchFallback({
        query,
        filters,
        page,
        limit,
        sort,
        multiSearch
      })

      await setCache(
        `meilisearch:fallback:v3:${crypto
          .createHash('md5')
          .update(JSON.stringify({ query, filters, page, limit, sort, multiSearch }))
          .digest('hex')}`,
        fallback,
        120
      ).catch(() => {})

      const res = successResponse({
        ...fallback,
        degraded: true,
        source: 'search-prisma-fallback'
      }, context)
      res.headers.set('X-Cache', 'MISS')
      return res
    }

    console.error('Search API error:', error)
    return errorResponse({
      status: 500,
      code: 'SEARCH_FAILED',
      message,
      context
    })
  }
}

type PrismaFallbackInput = {
  query: string
  filters: SearchFiltersPayload
  page: number
  limit: number
  sort?: string
  multiSearch: boolean
}

function isPriceSensitiveSearch(input: {
  sort?: string
  filters: SearchFiltersPayload
}): boolean {
  return (
    input.sort === 'price-asc' ||
    input.sort === 'price-desc' ||
    input.filters.minPrice !== undefined ||
    input.filters.maxPrice !== undefined
  )
}

function parseDecimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value == null) return null
  if (value instanceof Prisma.Decimal) return value

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Prisma.Decimal(value)
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) return null
    try {
      return new Prisma.Decimal(normalized)
    } catch {
      return null
    }
  }

  return null
}

async function enrichMeiliHitsWithPublicPricing(rawHits: any[]): Promise<SearchHit[]> {
  if (rawHits.length === 0) return []

  const ids = Array.from(
    new Set(
      rawHits
        .map((hit) =>
          typeof hit.id === 'number' ? hit.id : Number.parseInt(String(hit.id), 10)
        )
        .filter((id): id is number => Number.isInteger(id) && id > 0)
    )
  )

  if (ids.length === 0) {
    return rawHits.map((hit) => ({
      ...hit,
      price: decimalToString(
        resolvePublicPriceAndPurchasability({
          realPriceExVat: parseDecimalOrNull(hit.price),
          categoryMinRealPriceExVat: null,
          stockQty: 0,
          reservedStockQty: 0
        }).resolvedPriceExVat
      ),
      stockQty: 0,
      priceSource: parseDecimalOrNull(hit.price) ? 'real' : 'placeholder',
      isPlaceholderPrice: !parseDecimalOrNull(hit.price),
      isPurchasable: false
    }))
  }

  const parts = await db.parts.findMany({
    where: {
      id: {
        in: ids.map((id) => BigInt(id))
      }
    },
    select: {
      id: true,
      category_id: true,
      price: true,
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
    }
  })

  const partById = new Map(parts.map((part) => [Number(part.id), part]))
  const categoryMinPriceMap = await getCategoryMinRealPriceMap(
    Array.from(
      new Set(
        rawHits
          .map((hit) => {
            const id =
              typeof hit.id === 'number'
                ? hit.id
                : Number.parseInt(String(hit.id), 10)
            const part = Number.isInteger(id) ? partById.get(id) : undefined
            return part?.category_id ?? hit.categoryId
          })
          .filter((categoryId): categoryId is number =>
            Number.isInteger(categoryId) && categoryId > 0
          )
      )
    )
  )

  return rawHits.map((hit) => {
    const id =
      typeof hit.id === 'number'
        ? hit.id
        : Number.parseInt(String(hit.id), 10)
    const part = Number.isInteger(id) ? partById.get(id) : undefined
    const categoryId =
      part?.category_id ??
      (Number.isInteger(hit.categoryId) ? hit.categoryId : 0)
    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat: part
        ? resolveRealPriceExVat(part)
        : parseDecimalOrNull(hit.price),
      categoryMinRealPriceExVat:
        categoryId > 0 ? categoryMinPriceMap.get(categoryId) : null,
      stockQty: part?.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: part?.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    return {
      ...hit,
      price: decimalToString(pricing.resolvedPriceExVat),
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable
    }
  })
}

function buildTokenBundleCondition(
  alternatives: string[],
  options?: { includeVehicleFields?: boolean }
): Prisma.partsWhereInput {
  const orConditions: Prisma.partsWhereInput[] = []
  const includeVehicleFields = options?.includeVehicleFields !== false

  for (const value of alternatives) {
    if (!value) continue

    orConditions.push({ name: { contains: value, mode: Prisma.QueryMode.insensitive } })
    orConditions.push({
      part_brands: { name: { contains: value, mode: Prisma.QueryMode.insensitive } }
    })
    orConditions.push({
      part_categories: { name: { contains: value, mode: Prisma.QueryMode.insensitive } }
    })
    orConditions.push({
      part_categories: { name_tr: { contains: value, mode: Prisma.QueryMode.insensitive } }
    })
    orConditions.push({
      part_infos: {
        some: { content: { contains: value, mode: Prisma.QueryMode.insensitive } }
      }
    })
    orConditions.push({
      part_oens: {
        some: {
          OR: [
            { code: { contains: value, mode: Prisma.QueryMode.insensitive } },
            { brand: { contains: value, mode: Prisma.QueryMode.insensitive } }
          ]
        }
      }
    })
    orConditions.push({
      part_eans: {
        some: { code: { contains: value, mode: Prisma.QueryMode.insensitive } }
      }
    })
    orConditions.push({
      part_cross_references: {
        some: {
          OR: [
            {
              article_number: {
                contains: value,
                mode: Prisma.QueryMode.insensitive
              }
            },
            {
              brand_name: { contains: value, mode: Prisma.QueryMode.insensitive }
            }
          ]
        }
      }
    })
    orConditions.push({
      part_properties: {
        some: {
          OR: [
            { key: { contains: value, mode: Prisma.QueryMode.insensitive } },
            { value: { contains: value, mode: Prisma.QueryMode.insensitive } }
          ]
        }
      }
    })
    if (includeVehicleFields) {
      orConditions.push({
        part_vehicle_types: {
          some: {
            OR: [
              {
                vehicle_types: {
                  name: { contains: value, mode: Prisma.QueryMode.insensitive }
                }
              },
              {
                vehicle_types: {
                  vehicle_models: {
                    name: { contains: value, mode: Prisma.QueryMode.insensitive }
                  }
                }
              },
              {
                vehicle_types: {
                  vehicle_models: {
                    vehicle_brands: {
                      name: { contains: value, mode: Prisma.QueryMode.insensitive }
                    }
                  }
                }
              },
              {
                vehicle_types: {
                  vehicle_type_modification: {
                    is: {
                      OR: [
                        {
                          manu_name: {
                            contains: value,
                            mode: Prisma.QueryMode.insensitive
                          }
                        },
                        {
                          model_name: {
                            contains: value,
                            mode: Prisma.QueryMode.insensitive
                          }
                        },
                        {
                          type_name: {
                            contains: value,
                            mode: Prisma.QueryMode.insensitive
                          }
                        },
                        {
                          motor_type: {
                            contains: value,
                            mode: Prisma.QueryMode.insensitive
                          }
                        }
                      ]
                    }
                  }
                }
              }
            ]
          }
        }
      })
    }
  }

  if (orConditions.length === 0) {
    return { name: { equals: '__hybrid_search_no_match__' } }
  }

  return { OR: orConditions }
}

function buildFastTokenBundleCondition(
  alternatives: string[]
): Prisma.partsWhereInput {
  const orConditions: Prisma.partsWhereInput[] = []

  for (const value of alternatives) {
    if (!value) continue
    orConditions.push({
      name: { contains: value, mode: Prisma.QueryMode.insensitive }
    })
    orConditions.push({
      part_brands: {
        name: { contains: value, mode: Prisma.QueryMode.insensitive }
      }
    })
    orConditions.push({
      part_categories: {
        OR: [
          { name: { contains: value, mode: Prisma.QueryMode.insensitive } },
          { name_tr: { contains: value, mode: Prisma.QueryMode.insensitive } }
        ]
      }
    })
    orConditions.push({
      part_oens: {
        some: {
          OR: [
            { code: { contains: value, mode: Prisma.QueryMode.insensitive } },
            { brand: { contains: value, mode: Prisma.QueryMode.insensitive } }
          ]
        }
      }
    })
    orConditions.push({
      part_eans: {
        some: { code: { contains: value, mode: Prisma.QueryMode.insensitive } }
      }
    })
    orConditions.push({
      part_cross_references: {
        some: {
          OR: [
            {
              article_number: {
                contains: value,
                mode: Prisma.QueryMode.insensitive
              }
            },
            {
              brand_name: { contains: value, mode: Prisma.QueryMode.insensitive }
            }
          ]
        }
      }
    })
  }

  if (orConditions.length === 0) {
    return { name: { equals: '__hybrid_search_no_match__' } }
  }

  return { OR: orConditions }
}

function buildPrismaWhere(
  query: string,
  filters: SearchFiltersPayload,
  excludeFacet?: 'brandName' | 'categoryName',
  options?: {
    requireRealPrice?: boolean
    queryTokenBundles?: ReturnType<typeof buildHybridTokenBundles>
    includeVehicleFields?: boolean
    coarseQueryMatch?: boolean
    codeLikeQuery?: boolean
  }
): Prisma.partsWhereInput {
  const where: Prisma.partsWhereInput = {}
  const andConditions: Prisma.partsWhereInput[] = []

  const tokenBundles = options?.queryTokenBundles ?? buildHybridTokenBundles(query)
  if (tokenBundles.length > 0) {
    if (options?.coarseQueryMatch) {
      if (options.codeLikeQuery) {
        const compactQuery = query
          .toLowerCase()
          .replace(/[^0-9a-z]+/g, '')
          .trim()
        const codeNeedle = compactQuery.length >= 3 ? compactQuery : query.trim()

        andConditions.push({
          OR: [
            {
              name: { contains: query.trim(), mode: Prisma.QueryMode.insensitive }
            },
            ...(compactQuery.length >= 3
              ? [
                  {
                    name: {
                      contains: compactQuery,
                      mode: Prisma.QueryMode.insensitive
                    }
                  } as Prisma.partsWhereInput
                ]
              : []),
            {
              part_oens: {
                some: {
                  code: {
                    contains: codeNeedle,
                    mode: Prisma.QueryMode.insensitive
                  }
                }
              }
            },
            {
              part_eans: {
                some: {
                  code: {
                    contains: codeNeedle,
                    mode: Prisma.QueryMode.insensitive
                  }
                }
              }
            },
            {
              part_cross_references: {
                some: {
                  article_number: {
                    contains: codeNeedle,
                    mode: Prisma.QueryMode.insensitive
                  }
                }
              }
            }
          ]
        })
      } else {
        andConditions.push({
          OR: tokenBundles.map((bundle) =>
            buildFastTokenBundleCondition(bundle.alternatives)
          )
        })
      }
    } else {
      andConditions.push({
        AND: tokenBundles.map((bundle) =>
          buildTokenBundleCondition(bundle.alternatives, {
            includeVehicleFields: options?.includeVehicleFields
          })
        )
      })
    }
  } else if (query.trim().length > 0) {
    const fallback = query.trim()
    andConditions.push({
      OR: [
        { name: { contains: fallback, mode: Prisma.QueryMode.insensitive } },
        {
          part_brands: {
            name: { contains: fallback, mode: Prisma.QueryMode.insensitive }
          }
        },
        {
          part_categories: {
            name: { contains: fallback, mode: Prisma.QueryMode.insensitive }
          }
        },
        {
          part_oens: {
            some: {
              code: { contains: fallback, mode: Prisma.QueryMode.insensitive }
            }
          }
        }
      ]
    })
  }

  if (filters.brands && filters.brands.length > 0 && excludeFacet !== 'brandName') {
    andConditions.push({
      part_brands: {
        name: {
          in: filters.brands,
          mode: 'insensitive'
        }
      }
    })
  }

  if (
    filters.categories &&
    filters.categories.length > 0 &&
    excludeFacet !== 'categoryName'
  ) {
    andConditions.push({
      part_categories: {
        name: {
          in: filters.categories,
          mode: 'insensitive'
        }
      }
    })
  }

  if (filters.brandName && excludeFacet !== 'brandName') {
    andConditions.push({
      part_brands: { name: { equals: filters.brandName, mode: 'insensitive' } }
    })
  }

  if (filters.categoryName && excludeFacet !== 'categoryName') {
    andConditions.push({
      part_categories: { name: { equals: filters.categoryName, mode: 'insensitive' } }
    })
  }

  if (typeof filters.brandId === 'number') {
    andConditions.push({ brand_id: filters.brandId })
  }

  if (typeof filters.categoryId === 'number') {
    andConditions.push({ category_id: filters.categoryId })
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceRange = {
      ...(filters.minPrice !== undefined
        ? { gte: new Prisma.Decimal(filters.minPrice) }
        : {}),
      ...(filters.maxPrice !== undefined
        ? { lte: new Prisma.Decimal(filters.maxPrice) }
        : {})
    } satisfies Prisma.DecimalFilter

    andConditions.push({
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
    })
  }

  if (filters.vehicleIds && filters.vehicleIds.length > 0) {
    andConditions.push({
      part_vehicle_types: {
        some: {
          vehicle_type_id: {
            in: filters.vehicleIds
          }
        }
      }
    })
  }

  if (filters.inBasket !== undefined) {
    andConditions.push({ in_basket: filters.inBasket })
  }

  if (options?.requireRealPrice) {
    andConditions.push(REAL_PRICE_EXISTS_WHERE)
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  return where
}

function getPrismaSort(sort?: string): Prisma.partsOrderByWithRelationInput[] {
  switch (sort) {
    case 'price-asc':
      return [{ price: 'asc' }, { id: 'asc' }]
    case 'price-desc':
      return [{ price: 'desc' }, { id: 'desc' }]
    case 'name':
      return [{ name: 'asc' }]
    default:
      return [{ updated_at: 'desc' }]
  }
}

function resolveComparablePrice(
  part: any,
  categoryMinPriceMap: Map<number, Prisma.Decimal>
): number | null {
  const pricing = resolvePublicPriceAndPurchasability({
    realPriceExVat: resolveRealPriceExVat(part),
    categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id) ?? null,
    stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
    reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
  })
  if (!pricing.resolvedPriceExVat) return null

  const asNumber = Number(pricing.resolvedPriceExVat.toString())
  return Number.isFinite(asNumber) ? asNumber : null
}

function compareHybridScores(
  left: HybridScore,
  right: HybridScore
): number {
  if (left.codeRank !== right.codeRank) return right.codeRank - left.codeRank
  if (left.phraseRank !== right.phraseRank) {
    return right.phraseRank - left.phraseRank
  }
  if (left.tokenMatches !== right.tokenMatches) {
    return right.tokenMatches - left.tokenMatches
  }
  return 0
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: 'asc' | 'desc'
): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return direction === 'asc' ? left - right : right - left
}

function compareHybridRankedParts(
  left: {
    part: any
    score: HybridScore
    comparablePrice: number | null
  },
  right: {
    part: any
    score: HybridScore
    comparablePrice: number | null
  },
  sort?: string
): number {
  const byScore = compareHybridScores(left.score, right.score)
  if (byScore !== 0) return byScore

  if (sort === 'price-asc' || sort === 'price-desc') {
    const byPrice = compareNullableNumbers(
      left.comparablePrice,
      right.comparablePrice,
      sort === 'price-asc' ? 'asc' : 'desc'
    )
    if (byPrice !== 0) return byPrice
  }

  if (sort === 'name') {
    const byName = String(left.part.name || '').localeCompare(
      String(right.part.name || ''),
      'tr'
    )
    if (byName !== 0) return byName
  }

  const updatedTimeDiff =
    right.part.updated_at.getTime() - left.part.updated_at.getTime()
  if (updatedTimeDiff !== 0) return updatedTimeDiff

  return Number(right.part.id) - Number(left.part.id)
}

function normalizeCodeLookupValue(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function scoreCodeLookupMatch(
  value: string,
  rawUpper: string,
  compactQuery: string
): number {
  const trimmed = value.trim()
  if (!trimmed) return 0

  const upper = trimmed.toUpperCase()
  const normalized = normalizeCodeLookupValue(trimmed)
  if (!normalized) return 0

  if (normalized === compactQuery) return 120
  if (upper === rawUpper) return 100
  if (normalized.startsWith(compactQuery) || compactQuery.startsWith(normalized)) {
    return 80
  }
  if (normalized.includes(compactQuery)) return 60
  if (upper.includes(rawUpper)) return 40

  return 0
}

function buildVehicleSearchTexts(part: any): string[] {
  return (part.part_vehicle_types || []).flatMap((item: any) => {
    const vt = item.vehicle_types
    const vm = vt?.vehicle_models
    const vb = vm?.vehicle_brands
    const mod = vt?.vehicle_type_modification

    return [
      String(item.vehicle_type_id),
      vt?.name,
      vm?.name,
      vb?.name,
      mod?.manu_name,
      mod?.model_name,
      mod?.type_name,
      mod?.motor_type
    ].filter(Boolean)
  })
}

async function rankHybridCandidates(input: {
  parts: any[]
  query: string
  queryTokenBundles: ReturnType<typeof buildHybridTokenBundles>
  sort?: string
}): Promise<{
  ranked: Array<{
    part: any
    score: HybridScore
    comparablePrice: number | null
  }>
  categoryMinPriceMap: Map<number, Prisma.Decimal>
}> {
  const categoryMinPriceMap = await getCategoryMinRealPriceMap(
    Array.from(new Set(input.parts.map((part) => part.category_id)))
  )

  const ranked = input.parts
    .map((part) => {
      const score = scoreHybridDocument({
        query: input.query,
        partId: part.id.toString(),
        articleLinkId: part.article_link_id.toString(),
        name: part.name,
        brandName: part.part_brands?.name,
        categoryName: part.part_categories?.name,
        infoContents: (part.part_infos || []).map((item: any) => item.content),
        oemCodes: (part.part_oens || []).map((item: any) => item.code),
        eanCodes: (part.part_eans || []).map((item: any) => item.code),
        crossReferenceCodes: (part.part_cross_references || []).map(
          (item: any) => item.article_number
        ),
        crossReferenceBrands: (part.part_cross_references || []).map(
          (item: any) => item.brand_name
        ),
        propertyPairs: (part.part_properties || []).map(
          (prop: any) => `${prop.key ?? ''} ${prop.value ?? ''}`.trim()
        ),
        vehicleTexts: buildVehicleSearchTexts(part)
      })
      const comparablePrice = resolveComparablePrice(part, categoryMinPriceMap)
      return { part, score, comparablePrice }
    })
    .filter((item) =>
      input.queryTokenBundles.length === 0
        ? true
        : item.score.tokenMatches >= input.queryTokenBundles.length
    )
    .sort((left, right) => compareHybridRankedParts(left, right, input.sort))

  return { ranked, categoryMinPriceMap }
}

function mapPartsToHits(
  parts: any[],
  categoryMinPriceMap: Map<number, Prisma.Decimal>
): SearchHit[] {
  return parts.map((part) => {
    const oemCodes = (part.part_oens || []).slice(0, 24).map((item: any) => item.code)
    const eanCodes = (part.part_eans || []).slice(0, 24).map((item: any) => item.code)
    const crossCodes = (part.part_cross_references || [])
      .slice(0, 24)
      .map((item: any) => item.article_number)
    const mergedCodes = Array.from(
      new Set([...oemCodes, ...eanCodes, ...crossCodes].filter(Boolean))
    ).slice(0, 24)
    const mergedBrands = Array.from(
      new Set(
        [
          ...(part.part_oens || []).map((item: any) => item.brand),
          ...(part.part_cross_references || []).map((item: any) => item.brand_name)
        ].filter(Boolean)
      )
    ).slice(0, 24)
    const searchableText = [
      part.name,
      part.part_brands?.name,
      part.part_categories?.name,
      part.part_categories?.name_tr,
      ...(part.part_infos || []).map((item: any) => item.content),
      ...oemCodes,
      ...eanCodes,
      ...crossCodes,
      ...(part.part_properties || []).map(
        (prop: any) => `${prop.key ?? ''} ${prop.value ?? ''}`.trim()
      )
    ]
      .filter(Boolean)
      .join(' ')

    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat: resolveRealPriceExVat(part),
      categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
      stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    return {
      id: part.id.toString(),
      name: part.name,
      articleLinkId: part.article_link_id.toString(),
      price: decimalToString(pricing.resolvedPriceExVat),
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable,
      inBasket: part.in_basket,
      brandId: part.brand_id,
      brandName: part.part_brands?.name ?? '',
      brandLogo: part.part_brands?.logo_url ?? null,
      categoryId: part.category_id,
      categoryName: part.part_categories?.name ?? null,
      categoryNameTr: part.part_categories?.name_tr ?? null,
      oemCodes: mergedCodes,
      oemBrands: mergedBrands,
      vehicleTypes: [],
      vehicleIds: (part.part_vehicle_types || [])
        .slice(0, 24)
        .map((item: any) => item.vehicle_type_id),
      vehicleNames: [],
      formattedCompatibility: [],
      searchableText,
      images: (part.part_images || []).slice(0, 4).map((image: any) => ({
        image: image.image,
        thumb: image.thumb
      })),
      properties: (part.part_properties || []).slice(0, 8).map((prop: any) => ({
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
    }
  })
}

function normalizeSearchSort(sort?: string): CatalogHitSortOption {
  if (sort === 'price-asc' || sort === 'price-desc' || sort === 'name') {
    return sort
  }

  return 'popularity'
}

async function resolveSupplierFilterBrandIds(
  filters: SearchFiltersPayload
): Promise<number[]> {
  if (typeof filters.brandId === 'number' && filters.brandId > 0) {
    return [filters.brandId]
  }

  if (!filters.brands || filters.brands.length === 0) {
    return []
  }

  const brandNames = filters.brands
    .map((name) => name.trim())
    .filter(Boolean)

  if (brandNames.length === 0) {
    return []
  }

  const rows = await db.part_brands.findMany({
    where: {
      OR: brandNames.map((name) => ({
        name: {
          equals: name,
          mode: 'insensitive' as const
        }
      }))
    },
    select: {
      id: true
    },
    take: 120
  })

  return Array.from(new Set(rows.map((row) => row.id)))
}

async function mergeResolvedSupplierHitsForSearch(input: {
  hits: SearchHit[]
  filters: SearchFiltersPayload
  query: string
  page: number
  limit: number
  sort?: string
}): Promise<SearchHit[]> {
  if (input.limit <= 0) return []

  const brandIds = await resolveSupplierFilterBrandIds(input.filters)
  const categoryId =
    typeof input.filters.categoryId === 'number' && input.filters.categoryId > 0
      ? input.filters.categoryId
      : null
  const vehicleId =
    Array.isArray(input.filters.vehicleIds) && input.filters.vehicleIds.length > 0
      ? input.filters.vehicleIds[0]
      : null

  const supplierResult = await fetchResolvedSupplierCatalogHits({
    categoryName:
      input.filters.categoryName || input.filters.categories?.[0] || undefined,
    searchIds: categoryId ? [categoryId] : [],
    vehicleId,
    brandIds,
    minPrice: input.filters.minPrice,
    maxPrice: input.filters.maxPrice,
    query: input.query,
    sort: normalizeSearchSort(input.sort),
    page: input.page,
    limit: Math.max(input.limit, Math.min(input.limit * 3, 192)),
    includeTotal: false
  })

  return mergeCatalogHitsPage({
    partHits: input.hits,
    supplierHits: supplierResult.hits,
    sort: normalizeSearchSort(input.sort),
    limit: Math.max(1, input.limit)
  })
}

async function runPrismaSearchFallback(input: PrismaFallbackInput) {
  const requireRealPrice = isPriceSensitiveSearch({
    sort: input.sort,
    filters: input.filters
  })
  const queryTokenBundles = buildHybridTokenBundles(input.query)
  const useHybridRanking = queryTokenBundles.length > 0
  const isCodeLikeQuery =
    queryTokenBundles.length > 0 &&
    queryTokenBundles.every((bundle) => /\d/.test(bundle.token))
  const isFastGlobalLookup =
    !input.multiSearch && input.page === 1 && Math.max(1, input.limit) <= 10
  const useLightHybridQuery = useHybridRanking && isFastGlobalLookup
  const where = buildPrismaWhere(input.query, input.filters, undefined, {
    requireRealPrice,
    queryTokenBundles,
    includeVehicleFields: !useLightHybridQuery,
    coarseQueryMatch: useHybridRanking,
    codeLikeQuery: isCodeLikeQuery
  })
  const offset = Math.max(0, (input.page - 1) * input.limit)

  const fullPartIncludeForHits = {
    part_brands: { select: { name: true, logo_url: true } },
    part_categories: { select: { name: true, name_tr: true } },
    part_images: { select: { image: true, thumb: true }, take: 4 },
    part_oens: { select: { code: true, brand: true }, take: 24 },
    part_eans: { select: { code: true }, take: 24 },
    part_cross_references: {
      select: { article_number: true, brand_name: true },
      take: 24
    },
    part_infos: { select: { content: true }, take: 8 },
    part_vehicle_types: {
      select: {
        vehicle_type_id: true,
        vehicle_types: {
          select: {
            name: true,
            vehicle_models: {
              select: {
                name: true,
                vehicle_brands: {
                  select: { name: true }
                }
              }
            },
            vehicle_type_modification: {
              select: {
                manu_name: true,
                model_name: true,
                type_name: true,
                motor_type: true
              }
            }
          }
        }
      },
      take: 24
    },
    part_properties: { select: { key: true, value: true }, take: 8 },
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
  } satisfies Prisma.partsInclude
  const lightPartIncludeForHits = {
    part_brands: { select: { name: true, logo_url: true } },
    part_categories: { select: { name: true, name_tr: true } },
    part_images: { select: { image: true, thumb: true }, take: 2 },
    part_oens: { select: { code: true, brand: true }, take: 16 },
    part_eans: { select: { code: true }, take: 16 },
    part_cross_references: {
      select: { article_number: true, brand_name: true },
      take: 16
    },
    part_infos: { select: { content: true }, take: 4 },
    part_vehicle_types: { select: { vehicle_type_id: true }, take: 16 },
    part_properties: { select: { key: true, value: true }, take: 6 },
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
  } satisfies Prisma.partsInclude
  const partIncludeForHits = useLightHybridQuery
    ? lightPartIncludeForHits
    : fullPartIncludeForHits

  const compactQuery = normalizeCodeLookupValue(input.query)
  const rawQuery = input.query.trim()
  const rawQueryUpper = rawQuery.toUpperCase()
  const shouldUseFastCodeLookup =
    isCodeLikeQuery &&
    compactQuery.length >= 4 &&
    queryTokenBundles.length <= 2

  if (shouldUseFastCodeLookup) {
    const exactNeedles = Array.from(
      new Set([rawQuery, rawQueryUpper, compactQuery].filter(Boolean))
    )

    const [
      exactCrossRows,
      exactOenRows,
      exactEanRows
    ] = await Promise.all([
      db.part_cross_references.findMany({
        where: {
          article_number: {
            in: exactNeedles
          }
        },
        select: {
          part_id: true,
          article_number: true
        },
        take: 200
      }),
      db.part_oens.findMany({
        where: {
          code: {
            in: exactNeedles
          }
        },
        select: {
          part_id: true,
          code: true
        },
        take: 200
      }),
      db.part_eans.findMany({
        where: {
          code: {
            in: exactNeedles
          }
        },
        select: {
          part_id: true,
          code: true
        },
        take: 200
      })
    ])

    let crossRows = exactCrossRows
    let oenRows = exactOenRows
    let eanRows = exactEanRows

    const exactPartCount = new Set(
      [
        ...exactCrossRows.map((row) => row.part_id.toString()),
        ...exactOenRows.map((row) => row.part_id.toString()),
        ...exactEanRows.map((row) => row.part_id.toString())
      ].filter(Boolean)
    ).size

    if (exactPartCount < 40) {
      const [broadCrossRows, broadOenRows, broadEanRows] = await Promise.all([
        db.part_cross_references.findMany({
          where: {
            OR: [
              {
                article_number: {
                  startsWith: rawQuery
                }
              },
              ...(compactQuery !== rawQueryUpper
                ? [
                    {
                      article_number: {
                        startsWith: compactQuery
                      }
                    }
                  ]
                : [])
            ]
          },
          select: {
            part_id: true,
            article_number: true
          },
          take: 220
        }),
        exactPartCount === 0
          ? db.part_oens.findMany({
              where: {
                OR: [
                  {
                    code: {
                      startsWith: rawQuery
                    }
                  },
                  ...(compactQuery !== rawQueryUpper
                    ? [
                        {
                          code: {
                            startsWith: compactQuery
                          }
                        }
                      ]
                    : [])
                ]
              },
              select: {
                part_id: true,
                code: true
              },
              take: 220
            })
          : Promise.resolve([]),
        exactPartCount === 0
          ? db.part_eans.findMany({
              where: {
                OR: [
                  {
                    code: {
                      startsWith: rawQuery
                    }
                  },
                  ...(compactQuery !== rawQueryUpper
                    ? [
                        {
                          code: {
                            startsWith: compactQuery
                          }
                        }
                      ]
                    : [])
                ]
              },
              select: {
                part_id: true,
                code: true
              },
              take: 220
            })
          : Promise.resolve([])
      ])

      crossRows = [...crossRows, ...broadCrossRows]
      oenRows = [...oenRows, ...broadOenRows]
      eanRows = [...eanRows, ...broadEanRows]
    }

    const partScoreMap = new Map<string, number>()
    const addCandidate = (
      partId: bigint,
      code: string,
      sourceBoost: number
    ) => {
      const baseScore = scoreCodeLookupMatch(code, rawQueryUpper, compactQuery)
      if (baseScore <= 0) return
      const nextScore = baseScore + sourceBoost
      const key = partId.toString()
      const prevScore = partScoreMap.get(key) ?? 0
      if (nextScore > prevScore) {
        partScoreMap.set(key, nextScore)
      }
    }

    for (const row of crossRows) addCandidate(row.part_id, row.article_number, 8)
    for (const row of oenRows) addCandidate(row.part_id, row.code, 5)
    for (const row of eanRows) addCandidate(row.part_id, row.code, 3)

    const sortedCandidateIds = Array.from(partScoreMap.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([id]) => BigInt(id))
      .slice(0, 500)

    if (sortedCandidateIds.length === 0) {
      const mergedHits = await mergeResolvedSupplierHitsForSearch({
        hits: [],
        filters: input.filters,
        query: input.query,
        page: input.page,
        limit: input.limit,
        sort: input.sort
      })

      if (!input.multiSearch) {
        return {
          hits: mergedHits,
          totalHits: mergedHits.length,
          facetDistribution: {},
          processingTimeMs: 0,
          query: input.query,
          cached: false
        }
      }

      const emptyFacet = { brandName: {} as Record<string, number> }
      const emptyCategoryFacet = { categoryName: {} as Record<string, number> }
      const estimatedTotalHits = mergedHits.length
      return {
        results: [
          {
            hits: mergedHits,
            estimatedTotalHits,
            facetDistribution: {
              ...emptyFacet,
              ...emptyCategoryFacet
            },
            processingTimeMs: 0,
            query: input.query
          },
          {
            hits: [],
            estimatedTotalHits,
            facetDistribution: emptyFacet,
            processingTimeMs: 0,
            query: input.query
          },
          {
            hits: [],
            estimatedTotalHits,
            facetDistribution: emptyCategoryFacet,
            processingTimeMs: 0,
            query: input.query
          }
        ],
        cached: false
      }
    }

    const filterOnlyWhere = buildPrismaWhere('', input.filters, undefined, {
      requireRealPrice,
      queryTokenBundles: [],
      includeVehicleFields: false
    })
    const filterAndConditions = Array.isArray(filterOnlyWhere.AND)
      ? filterOnlyWhere.AND
      : filterOnlyWhere.AND
        ? [filterOnlyWhere.AND]
        : []
    const fastLookupWhere: Prisma.partsWhereInput = {
      AND: [
        ...filterAndConditions,
        { id: { in: sortedCandidateIds } }
      ]
    }

    const candidateParts = await db.parts.findMany({
      where: fastLookupWhere,
      include: lightPartIncludeForHits,
      take: sortedCandidateIds.length
    })

    const candidateRankIndex = new Map(
      sortedCandidateIds.map((id, index) => [id.toString(), index])
    )

    const rankedCandidates = candidateParts.sort((left, right) => {
      const leftRank = candidateRankIndex.get(left.id.toString()) ?? Number.MAX_SAFE_INTEGER
      const rightRank =
        candidateRankIndex.get(right.id.toString()) ?? Number.MAX_SAFE_INTEGER
      if (leftRank !== rightRank) return leftRank - rightRank
      return right.updated_at.getTime() - left.updated_at.getTime()
    })

    const offset = Math.max(0, (input.page - 1) * input.limit)
    const pagedParts = rankedCandidates.slice(offset, offset + Math.max(1, input.limit))
    const categoryMinPriceMap = await getCategoryMinRealPriceMap(
      Array.from(new Set(pagedParts.map((part) => part.category_id)))
    )
    const hits = mapPartsToHits(pagedParts, categoryMinPriceMap)
    const mergedHits = await mergeResolvedSupplierHitsForSearch({
      hits,
      filters: input.filters,
      query: input.query,
      page: input.page,
      limit: input.limit,
      sort: input.sort
    })
    const totalHits = Math.max(rankedCandidates.length, mergedHits.length)

    if (!input.multiSearch) {
      return {
        hits: mergedHits,
        totalHits,
        facetDistribution: {},
        processingTimeMs: 0,
        query: input.query,
        cached: false
      }
    }

    const brandFacet = { brandName: {} as Record<string, number> }
    const categoryFacet = { categoryName: {} as Record<string, number> }
    return {
      results: [
        {
          hits: mergedHits,
          estimatedTotalHits: totalHits,
          facetDistribution: {
            ...brandFacet,
            ...categoryFacet
          },
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: totalHits,
          facetDistribution: brandFacet,
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: totalHits,
          facetDistribution: categoryFacet,
          processingTimeMs: 0,
          query: input.query
        }
      ],
      cached: false
    }
  }

  const partsPromise = useHybridRanking
    ? null
    : db.parts.findMany({
        where,
        orderBy: getPrismaSort(input.sort),
        skip: offset,
        take: Math.max(1, input.limit),
        include: partIncludeForHits
      })
  const totalPromise = useLightHybridQuery ? null : db.parts.count({ where })

  if (useHybridRanking) {
    const candidateTake = useLightHybridQuery
      ? 120
      : Math.min(
          Math.max(offset + Math.max(1, input.limit) * 8, 160),
          1200
        )
    const candidateParts = await db.parts.findMany({
      where,
      orderBy: [{ updated_at: 'desc' }],
      take: candidateTake,
      include: partIncludeForHits
    })
    const totalHitsFromDb = totalPromise ? await totalPromise : null

    let { ranked, categoryMinPriceMap } = await rankHybridCandidates({
      parts: candidateParts,
      query: input.query,
      queryTokenBundles,
      sort: input.sort
    })

    if (useLightHybridQuery && ranked.length === 0) {
      const fallbackWhere = buildPrismaWhere(input.query, input.filters, undefined, {
        requireRealPrice,
        queryTokenBundles,
        includeVehicleFields: true,
        coarseQueryMatch: true,
        codeLikeQuery: isCodeLikeQuery
      })
      const fallbackParts = await db.parts.findMany({
        where: fallbackWhere,
        orderBy: [{ updated_at: 'desc' }],
        take: 240,
        include: fullPartIncludeForHits
      })
      const fallbackRanked = await rankHybridCandidates({
        parts: fallbackParts,
        query: input.query,
        queryTokenBundles,
        sort: input.sort
      })
      ranked = fallbackRanked.ranked
      categoryMinPriceMap = fallbackRanked.categoryMinPriceMap
    }

    const pagedParts = ranked
      .slice(offset, offset + Math.max(1, input.limit))
      .map((item) => item.part)

    const hits = mapPartsToHits(pagedParts, categoryMinPriceMap)
    const mergedHits = await mergeResolvedSupplierHitsForSearch({
      hits,
      filters: input.filters,
      query: input.query,
      page: input.page,
      limit: input.limit,
      sort: input.sort
    })
    const totalHits =
      totalHitsFromDb ??
      Math.max(offset > 0 ? offset + ranked.length : ranked.length, mergedHits.length)

    if (!input.multiSearch) {
      return {
        hits: mergedHits,
        totalHits,
        facetDistribution: {},
        processingTimeMs: 0,
        query: input.query,
        cached: false
      }
    }

    const brandFacet = { brandName: {} as Record<string, number> }
    const categoryFacet = { categoryName: {} as Record<string, number> }

    return {
      results: [
        {
          hits: mergedHits,
          estimatedTotalHits: totalHits,
          facetDistribution: {
            ...brandFacet,
            ...categoryFacet
          },
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: totalHits,
          facetDistribution: brandFacet,
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: totalHits,
          facetDistribution: categoryFacet,
          processingTimeMs: 0,
          query: input.query
        }
      ],
      cached: false
    }
  }

  if (!input.multiSearch) {
    const [parts, totalHits] = await Promise.all([partsPromise!, totalPromise])
    const safeTotalHits = typeof totalHits === 'number' ? totalHits : 0
    const categoryMinPriceMap = await getCategoryMinRealPriceMap(
      Array.from(new Set(parts.map((part) => part.category_id)))
    )
    const hits = mapPartsToHits(parts, categoryMinPriceMap)
    const mergedHits = await mergeResolvedSupplierHitsForSearch({
      hits,
      filters: input.filters,
      query: input.query,
      page: input.page,
      limit: input.limit,
      sort: input.sort
    })

    return {
      hits: mergedHits,
      totalHits: Math.max(safeTotalHits, mergedHits.length),
      facetDistribution: {},
      processingTimeMs: 0,
      query: input.query,
      cached: false
    }
  }

  const [parts, totalHits] = await Promise.all([partsPromise!, totalPromise])
  const safeTotalHits = typeof totalHits === 'number' ? totalHits : 0

  const categoryMinPriceMap = await getCategoryMinRealPriceMap(
    Array.from(new Set(parts.map((part) => part.category_id)))
  )
  const hits = mapPartsToHits(parts, categoryMinPriceMap)
  const mergedHits = await mergeResolvedSupplierHitsForSearch({
    hits,
    filters: input.filters,
    query: input.query,
    page: input.page,
    limit: input.limit,
    sort: input.sort
  })
  const brandFacet = { brandName: {} as Record<string, number> }
  const categoryFacet = { categoryName: {} as Record<string, number> }

  if (input.multiSearch) {
    return {
      results: [
        {
          hits: mergedHits,
          estimatedTotalHits: Math.max(safeTotalHits, mergedHits.length),
          facetDistribution: {
            ...brandFacet,
            ...categoryFacet
          },
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: Math.max(safeTotalHits, mergedHits.length),
          facetDistribution: brandFacet,
          processingTimeMs: 0,
          query: input.query
        },
        {
          hits: [],
          estimatedTotalHits: Math.max(safeTotalHits, mergedHits.length),
          facetDistribution: categoryFacet,
          processingTimeMs: 0,
          query: input.query
        }
      ],
      cached: false
    }
  }

  return {
    hits: mergedHits,
    totalHits: Math.max(safeTotalHits, mergedHits.length),
    facetDistribution: {
      ...brandFacet,
      ...categoryFacet
    },
    processingTimeMs: 0,
    query: input.query,
    cached: false
  }
}

/**
 * Build Meilisearch filter string from filters object
 * Matches the implementation in hooks/use-search.ts
 */
function buildMeilisearchFilter(
  filters: any,
  excludeFacet?: 'brandName' | 'categoryName',
  options?: { requireRealPrice?: boolean }
): string | null {
  const conditions: string[] = []

  // Brand filter (skip if we're calculating brand facet distribution)
  if (filters.brands && filters.brands.length > 0 && excludeFacet !== 'brandName') {
    const brandNames = filters.brands.map((b: string) => `"${b}"`).join(', ')
    conditions.push(`brandName IN [${brandNames}]`)
  }

  // Category filter (skip if we're calculating category facet distribution)
  if (filters.categories && filters.categories.length > 0 && excludeFacet !== 'categoryName') {
    const categoryNames = filters.categories.map((c: string) => `"${c}"`).join(', ')
    conditions.push(`categoryName IN [${categoryNames}]`)
  }

  // Legacy support for single brand/category
  if (filters.brandName && excludeFacet !== 'brandName') {
    conditions.push(`brandName = "${filters.brandName}"`)
  }

  if (filters.categoryName && excludeFacet !== 'categoryName') {
    conditions.push(`categoryName = "${filters.categoryName}"`)
  }

  if (filters.brandId) {
    conditions.push(`brandId = ${filters.brandId}`)
  }

  if (filters.categoryId) {
    conditions.push(`categoryId = ${filters.categoryId}`)
  }

  // Price filters
  if (filters.minPrice !== undefined) {
    conditions.push(`price >= ${filters.minPrice}`)
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(`price <= ${filters.maxPrice}`)
  }

  // Vehicle filter (vehicleIds is an array field in Meilisearch)
  // Use = to check if array contains the value
  if (filters.vehicleIds && filters.vehicleIds.length > 0) {
    const vehicleConditions = filters.vehicleIds
      .map((id: number) => `vehicleIds = ${id}`)
      .join(' OR ')
    conditions.push(`(${vehicleConditions})`)
  }

  if (filters.inBasket !== undefined) {
    conditions.push(`inBasket = ${filters.inBasket}`)
  }

  if (options?.requireRealPrice) {
    conditions.push('price > 0')
  }

  return conditions.length > 0 ? conditions.join(' AND ') : null
}

/**
 * Convert sort option to Meilisearch sort format
 * Matches the implementation in hooks/use-search.ts
 */
function getMeiliSort(sort?: string): string[] {
  switch (sort) {
    case 'price-asc':
      return ['price:asc']
    case 'price-desc':
      return ['price:desc']
    case 'name':
      return ['name:asc']
    case 'name-asc':
      return ['name:asc']
    case 'name-desc':
      return ['name:desc']
    case 'popularity':
      return [] // Default Meilisearch relevance
    case 'newest':
      return ['createdAt:desc']
    case 'oldest':
      return ['createdAt:asc']
    default:
      return []
  }
}
