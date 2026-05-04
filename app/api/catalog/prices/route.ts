import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import {
  decimalToString,
  REAL_PRICE_EXISTS_WHERE,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'
import { getCategoryMinRealPriceMap } from '@/lib/pricing/public-pricing-db'
import { z } from 'zod'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

type PriceRequestBody = {
  partIds?: number[]
}

const priceRequestSchema: z.ZodSchema<PriceRequestBody> = z
  .object({
    partIds: z.array(z.number().int().positive()).optional()
  })
  .passthrough()

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:catalog:prices',
    limit: 180,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsed = await parseJsonBody(request, priceRequestSchema, context)
    if (!parsed.success) return parsed.response

    const body = parsed.data
    const partIds = Array.isArray(body.partIds)
      ? Array.from(
          new Set(
            body.partIds
              .filter((id) => Number.isInteger(id) && id > 0)
              .map((id) => Number(id))
          )
        ).slice(0, 120)
      : []

    if (partIds.length === 0) {
      return successResponse({ prices: {}, cached: false }, context)
    }

    const cacheKey = `catalog:prices:v2:${crypto
      .createHash('md5')
      .update(JSON.stringify(partIds.sort((a, b) => a - b)))
      .digest('hex')}`

    const cached = await getFromCache<unknown>(cacheKey)
    if (cached) {
      return successResponse(
        { ...(cached as Record<string, unknown>), cached: true },
        context
      )
    }

    const parts = await db.parts.findMany({
      where: {
        id: {
          in: partIds.map((id) => BigInt(id))
        }
      },
      select: {
        id: true,
        tecdoc_article_id: true,
        category_id: true,
        price: true,
        part_pricing_inventory: {
          select: {
            supplier_price: true,
            computed_selling_price_ex_vat: true,
            supplier_stock_qty: true,
            reserved_stock_qty: true,
            currency: true
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

    const missingTecdocArticleIds = Array.from(
      new Set(
        parts
          .filter((part) => !resolveRealPriceExVat(part))
          .map((part) => part.tecdoc_article_id)
          .filter((id): id is bigint => typeof id === 'bigint' && id > BigInt(0))
      )
    )

    const fallbackPriceByTecdocId = new Map<bigint, Prisma.Decimal>()

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

    const categoryMinPriceMap = await getCategoryMinRealPriceMap(
      Array.from(new Set(parts.map((part) => part.category_id)))
    )

    const prices = Object.fromEntries(
      parts.map((part) => {
        const inventory = part.part_pricing_inventory
        const tecdocId = part.tecdoc_article_id
        const fallbackPrice = tecdocId != null ? fallbackPriceByTecdocId.get(tecdocId) : null
        const pricing = resolvePublicPriceAndPurchasability({
          realPriceExVat: resolveRealPriceExVat(part) ?? fallbackPrice ?? null,
          categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
          stockQty: inventory?.supplier_stock_qty ?? 0,
          reservedStockQty: inventory?.reserved_stock_qty ?? 0
        })

        return [
          part.id.toString(),
          {
            price: decimalToString(pricing.resolvedPriceExVat),
            currency: inventory?.currency ?? 'TRY',
            stockQty: pricing.stockQty,
            priceSource: pricing.priceSource,
            isPlaceholderPrice: pricing.isPlaceholderPrice,
            isPurchasable: pricing.isPurchasable
          }
        ]
      })
    )

    const response = { prices, cached: false }
    await setCache(cacheKey, response, 30)

    return successResponse(response, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'CATALOG_PRICES_FAILED',
      message:
        error instanceof Error ? error.message : 'Catalog prices fetch failed',
      context
    })
  }
}
