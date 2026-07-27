'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { getServerSession } from '@/lib/auth/server'
import {
  createOrderDraft,
  prepareCheckoutLines,
  type CheckoutIssue
} from '@/lib/orders/service'
import {
  CHECKOUT_PAYMENT_METHOD_VALUES,
  CHECKOUT_SHIPPING_METHOD_VALUES
} from '@/lib/orders/types'
import { getRequestOrigin, resolveSiteUrl } from '@/lib/site-url'

function buildCodResultUrl(locale: string, orderId: number, baseUrl?: string): string {
  const url = new URL(`/${locale}/checkout/result`, baseUrl || resolveSiteUrl())
  url.searchParams.set('orderId', String(orderId))
  url.searchParams.set('state', 'cod')
  return url.toString()
}

const checkoutItemSchema = z.object({
  // Sepet tarihsel olarak `partId` diyor ve bu ad localStorage'a (shop-cart:v2)
  // yazılmış durumda — yeniden adlandırmak mevcut sepetleri düşürürdü. Taşıdığı
  // değer catalog.products.id; sunucu sınırında bir kez `productId`'ye çevriliyor
  // ve aşağısı yalnızca onu konuşuyor.
  partId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(20)
})

const shippingAddressSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(32),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional().or(z.literal('')),
  city: z.string().min(2).max(80),
  postalCode: z.string().min(2).max(20),
  country: z.string().min(2).max(80)
})

const paymentCardSchema = z.object({
  holderName: z.string().min(2).max(120),
  number: z.string().regex(/^\d{13,19}$/),
  cvv: z.string().regex(/^\d{3,4}$/),
  expireMonth: z.number().int().min(1).max(12),
  expireYear: z.number().int().min(new Date().getFullYear()).max(new Date().getFullYear() + 20),
  installmentCount: z.number().int().min(1).max(12)
})

const checkoutInputSchema = z.object({
  items: z.array(checkoutItemSchema).min(1),
  contactEmail: z.string().email().max(320).optional().or(z.literal('')),
  shippingAddress: shippingAddressSchema,
  shippingMethod: z.enum(CHECKOUT_SHIPPING_METHOD_VALUES),
  paymentMethod: z.enum(CHECKOUT_PAYMENT_METHOD_VALUES),
  paymentCard: paymentCardSchema.optional(),
  note: z.string().max(500).optional().or(z.literal('')),
  locale: z.string().min(2).max(5).default('tr')
}).superRefine((value, ctx) => {
  if (value.paymentMethod === 'TAMI' && !value.paymentCard) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['paymentCard'],
      message: 'Card information is required for Tami payments.'
    })
  }
})

type CheckoutInput = z.infer<typeof checkoutInputSchema>

export type CreateCheckoutOrderResult =
  | {
      success: true
      orderId: number
      orderNumber: string
      totalAmount: string
      currency: 'TRY'
      redirectUrl: string
      paymentMethod: 'CASH_ON_DELIVERY'
      status: string
      paymentStatus: string
    }
  | {
      success: false
      code:
        | 'VALIDATION_ERROR'
        | 'CHECKOUT_FAILED'
        | 'ITEM_VALIDATION_FAILED'
      message: string
      issues?: CheckoutIssue[]
      fieldErrors?: Record<string, string[] | undefined>
    }

export async function createCheckoutOrder(
  input: CheckoutInput
): Promise<CreateCheckoutOrderResult> {
  const parsed = checkoutInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Checkout payload is invalid.',
      fieldErrors: parsed.error.flatten().fieldErrors
    }
  }

  const session = await getServerSession()
  const user = session?.user

  const data = parsed.data
  const normalizedContactEmail = data.contactEmail?.trim() || ''
  const guestEmail = !user ? normalizedContactEmail : null

  if (!user && !guestEmail) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Email is required for guest checkout.',
      fieldErrors: {
        contactEmail: ['Email is required for guest checkout.']
      }
    }
  }

  try {
    const requestHeaders = await headers()
    const requestOrigin = getRequestOrigin(requestHeaders)
    const orderItems = data.items.map((item) => ({
      productId: item.partId,
      quantity: item.quantity
    }))
    const prepared = await prepareCheckoutLines(orderItems)

    if (prepared.issues.length > 0 || prepared.lines.length === 0) {
      return {
        success: false,
        code: 'ITEM_VALIDATION_FAILED',
        message: 'One or more items are invalid for checkout.',
        issues: prepared.issues
      }
    }

    const draft = await createOrderDraft({
      userId: user?.id ?? null,
      guestEmail,
      items: orderItems,
      shippingAddress: data.shippingAddress,
      shippingMethod: data.shippingMethod,
      paymentMethod: data.paymentMethod,
      note: data.note?.trim() || undefined
    })

    if (data.paymentMethod === 'CASH_ON_DELIVERY') {
      return {
        success: true,
        orderId: draft.orderId,
        orderNumber: draft.orderNumber,
        totalAmount: draft.totalAmount,
        currency: draft.currency,
        redirectUrl: buildCodResultUrl(data.locale, draft.orderId, requestOrigin || undefined),
        paymentMethod: 'CASH_ON_DELIVERY',
        status: draft.status,
        paymentStatus: draft.paymentStatus
      }
    }

    return {
      success: false,
      code: 'CHECKOUT_FAILED',
      message: 'Online payment is currently unavailable. Please use cash on delivery.'
    }
  } catch (error) {
    console.error('createCheckoutOrder failed:', error)
    return {
      success: false,
      code: 'CHECKOUT_FAILED',
      message: 'Checkout could not be completed. Please try again.'
    }
  }
}
