import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { resolveRealPriceExVat } from '@/lib/pricing/public-pricing'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { createCartEventNotifications } from '@/lib/notifications/server'
import type { CartReconcileEvent } from '@/lib/notifications/types'
import { toVatIncludedDecimal } from '@/lib/orders/types'

const cartItemSchema = z.object({
  partId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(100),
  knownPrice: z.number().positive().optional().nullable()
})

const reconcileSchema = z.object({
  items: z.array(cartItemSchema).max(200)
})

function toImageUrl(part: {
  part_images: Array<{ thumb: string | null; image: string | null }>
}): string {
  const firstImage = part.part_images[0]
  return firstImage?.thumb || firstImage?.image || '/logo.png'
}

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:cart:reconcile',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsed = await parseJsonBody(request, reconcileSchema, context)
    if (!parsed.success) return parsed.response

    const items = parsed.data.items
    if (items.length === 0) {
      return successResponse({ items: [], events: [], changed: false }, context)
    }

    const uniquePartIds = Array.from(new Set(items.map((item) => item.partId)))

    const parts = await db.parts.findMany({
      where: {
        id: {
          in: uniquePartIds.map((id) => BigInt(id))
        }
      },
      select: {
        id: true,
        name: true,
        price: true,
        part_brands: {
          select: {
            name: true
          }
        },
        part_images: {
          select: {
            thumb: true,
            image: true
          },
          take: 1
        },
        part_pricing_inventory: {
          select: {
            supplier_stock_qty: true,
            reserved_stock_qty: true,
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
      }
    })

    const partById = new Map(parts.map((part) => [Number(part.id), part]))
    const events: CartReconcileEvent[] = []

    const reconciledItems = items.flatMap((item) => {
      const part = partById.get(item.partId)
      if (!part) {
        events.push({
          type: 'CART_ITEM_REMOVED',
          partId: item.partId,
          message: `Parça #${item.partId} sepetten kaldırıldı (ürün bulunamadı).`,
          oldQuantity: item.quantity,
          newQuantity: 0,
          reason: 'NOT_FOUND'
        })
        return []
      }

      const resolvedPrice = resolveRealPriceExVat(part)
      if (!resolvedPrice) {
        events.push({
          type: 'CART_ITEM_REMOVED',
          partId: item.partId,
          message: `${part.name} sepetten kaldırıldı (geçerli fiyat yok).`,
          oldQuantity: item.quantity,
          newQuantity: 0,
          reason: 'PRICE_UNAVAILABLE'
        })
        return []
      }

      const stockQty = part.part_pricing_inventory?.supplier_stock_qty ?? 0
      const reservedQty = part.part_pricing_inventory?.reserved_stock_qty ?? 0
      const availableStock = Math.max(stockQty - reservedQty, 0)

      if (availableStock <= 0) {
        events.push({
          type: 'CART_ITEM_REMOVED',
          partId: item.partId,
          message: `${part.name} sepetten kaldırıldı (stokta yok).`,
          oldQuantity: item.quantity,
          newQuantity: 0,
          reason: 'OUT_OF_STOCK'
        })
        return []
      }

      const nextQuantity = Math.max(1, Math.min(item.quantity, availableStock))
      const displayPrice = toVatIncludedDecimal(resolvedPrice)
      const numericPrice = Number(displayPrice?.toString() || '0')
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        events.push({
          type: 'CART_ITEM_REMOVED',
          partId: item.partId,
          message: `${part.name} sepetten kaldırıldı (geçerli fiyat yok).`,
          oldQuantity: item.quantity,
          newQuantity: 0,
          reason: 'PRICE_UNAVAILABLE'
        })
        return []
      }

      if (
        item.knownPrice != null &&
        Number.isFinite(item.knownPrice) &&
        Math.abs(item.knownPrice - numericPrice) > 0.0001
      ) {
        events.push({
          type: 'CART_PRICE_CHANGED',
          partId: item.partId,
          message: `${part.name} fiyatı güncellendi.`,
          oldPrice: item.knownPrice,
          newPrice: numericPrice
        })
      }

      if (nextQuantity < item.quantity) {
        events.push({
          type: 'CART_STOCK_REDUCED',
          partId: item.partId,
          message: `${part.name} için adet ${nextQuantity} olarak güncellendi (stok kısıtı).`,
          oldQuantity: item.quantity,
          newQuantity: nextQuantity
        })
      }

      return [
        {
          partId: item.partId,
          id: String(item.partId),
          name: part.name,
          brand: part.part_brands?.name || '-',
          price: numericPrice,
          quantity: nextQuantity,
          imageUrl: toImageUrl(part)
        }
      ]
    })

    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (user?.id && events.length > 0) {
      await createCartEventNotifications(user.id, events)
    }

    return successResponse(
      {
        items: reconciledItems,
        events,
        changed: events.length > 0
      },
      context
    )
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'CART_RECONCILE_FAILED',
      message: error instanceof Error ? error.message : 'Cart reconcile failed.',
      context
    })
  }
}
