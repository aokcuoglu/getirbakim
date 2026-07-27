import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderStatusNotification, createUserNotifications } from '@/lib/notifications/server'
import {
  canAdminManageOrderStatus,
  CheckoutPaymentMethod,
  CheckoutShippingMethod,
  decimalToNumber,
  DEFAULT_CURRENCY,
  formatOrderNumber,
  getShippingFeeDecimal,
  OrderPaymentRecordStatus,
  OrderPaymentStatus,
  OrderStatus,
  parseOrderNumber,
  ShippingAddressInput,
  shouldReleaseReservedStock,
  toMoneyDecimal,
  toVatIncludedDecimal
} from '@/lib/orders/types'

/**
 * Checkout katalogtan okur, public.parts'tan değil.
 *
 * Sattığımız şey Dinamik/Başbuğ ürünlerinin kanonik katalog kaydı; parts
 * zenginleştirme arşivi. Sepet zaten `catalog.products.id` taşıyor
 * (CatalogProductDetail), eski hâlde ise burada parts'ta aranıyordu — iki id
 * uzayı örtüşmediği için aynı sayı bambaşka bir ürüne denk geliyordu.
 */
type CheckoutProductRecord = {
  id: bigint
  name: string
  min_selling_price_try: Prisma.Decimal | null
  total_stock_qty: number
  category: { name: string } | null
  product_overrides: {
    lock_price: boolean
    selling_price_override: Prisma.Decimal | null
  } | null
}

/** Rezervin ödeme penceresini kapsayacak kadar yaşaması yeter. */
const RESERVATION_TTL_MINUTES = 30

export type CheckoutIssue = {
  productId: number
  reason: 'NOT_FOUND' | 'PRICE_UNAVAILABLE' | 'OUT_OF_STOCK'
  message: string
}

export interface PreparedCheckoutLine {
  productId: number
  name: string
  quantity: number
  unitPrice: Prisma.Decimal
  lineTotal: Prisma.Decimal
  hasLiveStock: boolean
  categoryName: string | null
}

export interface CreateOrderDraftInput {
  userId: string | null
  guestEmail: string | null
  items: Array<{ productId: number; quantity: number }>
  shippingAddress: ShippingAddressInput
  shippingMethod: CheckoutShippingMethod
  paymentMethod: CheckoutPaymentMethod
  note?: string
}

export interface CreateOrderDraftResult {
  orderId: number
  orderNumber: string
  subtotalAmount: string
  shippingFee: string
  totalAmount: string
  currency: typeof DEFAULT_CURRENCY
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  paymentMethod: CheckoutPaymentMethod
}

export interface OrderPaymentView {
  id: number
  provider: string
  status: string
  amount: number
  currency: string
  providerPaymentId: string | null
  providerConversationId: string | null
  paidAt: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderLineView {
  id: number
  productId: string
  productName: string
  /** Katalogdaki parça numarası; ürün silinmişse '-'. */
  partNo: string
  quantity: number
  price: number
  lineTotal: number
}

export interface OrderView {
  id: number
  orderNumber: string
  userId: string | null
  guestName: string | null
  guestEmail: string | null
  guestPhone: string | null
  customerName: string
  customerEmail: string | null
  status: string
  paymentStatus: string
  paymentMethod: string | null
  shippingMethod: string | null
  subtotalAmount: number
  shippingFee: number
  totalAmount: number
  currency: string
  note: string | null
  shippingAddress: ShippingAddressInput | null
  createdAt: string
  updatedAt: string
  itemsCount: number
  items: OrderLineView[]
  latestPayment: OrderPaymentView | null
}

/** Kilitli admin fiyatı varsa o, yoksa katalogdaki en düşük satış fiyatı. */
export function resolveDisplayUnitPrice(
  product: CheckoutProductRecord
): Prisma.Decimal | null {
  const override = product.product_overrides
  const base =
    override?.lock_price && override.selling_price_override
      ? override.selling_price_override
      : product.min_selling_price_try
  return toVatIncludedDecimal(base ?? null)
}

/**
 * Ürün başına, süresi geçmemiş ACTIVE rezervlerin toplamı.
 *
 * Süresi geçenler sorguya hiç girmiyor: rezerv sayaç değil satır olduğu için
 * serbest bırakma adımı hiç çalışmasa bile stok kendiliğinden geri geliyor.
 */
async function getReservedQuantities(
  productIds: bigint[]
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()

  const rows = await db.stock_reservations.groupBy({
    by: ['product_id'],
    where: {
      product_id: { in: productIds },
      status: 'ACTIVE',
      expires_at: { gt: new Date() }
    },
    _sum: { quantity: true }
  })

  return new Map(rows.map((r) => [r.product_id.toString(), r._sum.quantity ?? 0]))
}

export async function prepareCheckoutLines(
  items: Array<{ productId: number; quantity: number }>
): Promise<{ issues: CheckoutIssue[]; lines: PreparedCheckoutLine[] }> {
  const uniqueIds = Array.from(new Set(items.map((item) => item.productId))).map((id) =>
    BigInt(id)
  )

  const [products, reservedByProduct] = await Promise.all([
    db.products.findMany({
      where: { id: { in: uniqueIds }, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        min_selling_price_try: true,
        total_stock_qty: true,
        category: { select: { name: true } },
        product_overrides: {
          select: { lock_price: true, selling_price_override: true }
        }
      }
    }),
    getReservedQuantities(uniqueIds)
  ])

  const byId = new Map(products.map((product) => [Number(product.id), product]))
  const issues: CheckoutIssue[] = []
  const lines: PreparedCheckoutLine[] = []

  for (const item of items) {
    const product = byId.get(item.productId)
    if (!product) {
      issues.push({
        productId: item.productId,
        reason: 'NOT_FOUND',
        message: `Product ${item.productId} could not be found.`
      })
      continue
    }

    const unitPrice = resolveDisplayUnitPrice(product)
    if (!unitPrice) {
      issues.push({
        productId: item.productId,
        reason: 'PRICE_UNAVAILABLE',
        message: `Product ${item.productId} has no valid checkout price.`
      })
      continue
    }

    // Stoğu 0 görünen ürün engellenmiyor: stok tedarikçinin ve senkron aralıklı,
    // "0" çoğu zaman "bilmiyoruz" demek. Eski davranış da böyleydi; rezerv
    // yalnızca elimizde sayı VARKEN çifte satışı önlemek için var.
    const stockQty = product.total_stock_qty ?? 0
    const reservedQty = reservedByProduct.get(product.id.toString()) ?? 0
    const hasLiveStock = stockQty > 0
    const available = Math.max(stockQty - reservedQty, 0)

    if (hasLiveStock && available < item.quantity) {
      issues.push({
        productId: item.productId,
        reason: 'OUT_OF_STOCK',
        message: `Product ${item.productId} does not have enough stock for quantity ${item.quantity}.`
      })
      continue
    }

    lines.push({
      productId: item.productId,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice.mul(item.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      hasLiveStock,
      categoryName: product.category?.name || null
    })
  }

  return { issues, lines }
}

function getInitialOrderStatuses(paymentMethod: CheckoutPaymentMethod): {
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
} {
  if (paymentMethod === 'TAMI') {
    return {
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING'
    }
  }

  return {
    status: 'PROCESSING',
    paymentStatus: 'NOT_REQUIRED'
  }
}

export async function createOrderDraft(
  input: CreateOrderDraftInput
): Promise<CreateOrderDraftResult> {
  const { issues, lines } = await prepareCheckoutLines(input.items)
  if (issues.length > 0 || lines.length === 0) {
    throw new Error('CHECKOUT_ITEMS_INVALID')
  }

  const subtotalAmount = lines.reduce(
    (sum, item) => sum.add(item.lineTotal),
    new Prisma.Decimal(0)
  )
  const shippingFee = getShippingFeeDecimal(input.shippingMethod)
  const totalAmount = subtotalAmount
    .add(shippingFee)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

  const initialStatuses = getInitialOrderStatuses(input.paymentMethod)

  const createdOrder = await db.$transaction(async (tx) => {
    const order = await tx.orders.create({
      data: {
        user_id: input.userId,
        guest_name: input.userId ? null : input.shippingAddress.fullName,
        guest_email: input.guestEmail,
        guest_phone: input.userId ? null : input.shippingAddress.phone,
        subtotal_amount: subtotalAmount,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        currency: DEFAULT_CURRENCY,
        status: initialStatuses.status,
        payment_status: initialStatuses.paymentStatus,
        shipping_method: input.shippingMethod,
        payment_method: input.paymentMethod,
        shipping_address_json: input.shippingAddress as unknown as Prisma.InputJsonValue,
        note: input.note?.trim() || null
      },
      select: {
        id: true,
        subtotal_amount: true,
        shipping_fee: true,
        total_amount: true,
        currency: true,
        status: true,
        payment_status: true,
        payment_method: true
      }
    })

    await tx.order_items.createMany({
      data: lines.map((item) => ({
        order_id: order.id,
        product_id: BigInt(item.productId),
        // Ad anlık kopyalanır: ürün sonradan yeniden adlandırılsa ya da
        // katalogdan düşse bile sipariş neyin sipariş edildiğini anlatmalı.
        product_name: item.name,
        quantity: item.quantity,
        price: item.unitPrice
      }))
    })

    // Stoğu bilinen satırlar için ödeme penceresi boyunca rezerv aç. Süresi
    // dolunca satır kendiliğinden sayılmaz olur; serbest bırakma adımının
    // çalışmasına bağlı değiliz.
    const reservedLines = lines.filter((item) => item.hasLiveStock)
    if (reservedLines.length > 0) {
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000)
      await tx.stock_reservations.createMany({
        data: reservedLines.map((item) => ({
          order_id: order.id,
          product_id: BigInt(item.productId),
          quantity: item.quantity,
          expires_at: expiresAt
        }))
      })
    }

    return order
  })

  return {
    orderId: createdOrder.id,
    orderNumber: formatOrderNumber(createdOrder.id),
    subtotalAmount: createdOrder.subtotal_amount.toString(),
    shippingFee: createdOrder.shipping_fee.toString(),
    totalAmount: createdOrder.total_amount.toString(),
    currency: DEFAULT_CURRENCY,
    status: createdOrder.status as OrderStatus,
    paymentStatus: createdOrder.payment_status as OrderPaymentStatus,
    paymentMethod: createdOrder.payment_method as CheckoutPaymentMethod
  }
}

export async function releaseReservedStockForOrder(
  tx: Prisma.TransactionClient,
  orderId: number
): Promise<boolean> {
  const order = await tx.orders.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      stock_released_at: true
    }
  })

  if (!order || order.stock_released_at) {
    return false
  }

  // Sayaç düşürmek yerine satırı kapat: idempotent (ikinci çağrı hiçbir şeyi
  // eksiye götürmez) ve zaten süresi geçmiş rezervler için de zararsız.
  await tx.stock_reservations.updateMany({
    where: { order_id: orderId, status: 'ACTIVE' },
    data: { status: 'RELEASED' }
  })

  await tx.orders.update({
    where: { id: orderId },
    data: {
      stock_released_at: new Date()
    }
  })

  return true
}

export async function createPaymentRecord(input: {
  orderId: number
  provider: string
  providerConversationId?: string | null
  status: OrderPaymentRecordStatus
  amount: Prisma.Decimal | number | string
  rawPayload?: Prisma.InputJsonValue
}): Promise<{ id: number }> {
  const row = await db.order_payments.create({
    data: {
      order_id: input.orderId,
      provider: input.provider,
      provider_conversation_id: input.providerConversationId ?? null,
      status: input.status,
      amount: toMoneyDecimal(input.amount),
      currency: DEFAULT_CURRENCY,
      raw_payload: input.rawPayload ?? Prisma.JsonNull
    },
    select: {
      id: true
    }
  })

  return row
}

export async function updatePaymentRecord(input: {
  paymentId: number
  status: OrderPaymentRecordStatus
  providerPaymentId?: string | null
  failureReason?: string | null
  paidAt?: Date | null
  rawPayload?: Prisma.InputJsonValue
}): Promise<void> {
  await db.order_payments.update({
    where: { id: input.paymentId },
    data: {
      status: input.status,
      provider_payment_id: input.providerPaymentId,
      failure_reason: input.failureReason,
      paid_at: input.paidAt,
      raw_payload: input.rawPayload ?? undefined,
      updated_at: new Date()
    }
  })
}

async function createOrderPaymentNotification(input: {
  userId: string | null
  orderId: number
  type: 'ORDER_PAYMENT_SUCCEEDED' | 'ORDER_PAYMENT_FAILED'
  message: string
}) {
  if (!input.userId) return

  await createUserNotifications(input.userId, [
    {
      type: input.type,
      title:
        input.type === 'ORDER_PAYMENT_SUCCEEDED'
          ? `Sipariş #${input.orderId} ödemesi onaylandı`
          : `Sipariş #${input.orderId} ödemesi başarısız`,
      message: input.message,
      payload: {
        orderId: input.orderId
      }
    }
  ])
}

export async function markOrderPaymentSucceeded(input: {
  orderId: number
  paymentId: number
  providerPaymentId?: string | null
  rawPayload?: Prisma.InputJsonValue
}): Promise<void> {
  let nextStatus: string | null = null

  await db.$transaction(async (tx) => {
    const existingOrder = await tx.orders.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        user_id: true
      }
    })

    if (!existingOrder) {
      throw new Error('ORDER_NOT_FOUND')
    }

    if (existingOrder.status === 'PAID') {
      await tx.order_payments.update({
        where: { id: input.paymentId },
        data: {
          status: 'SUCCEEDED',
          provider_payment_id: input.providerPaymentId,
          raw_payload: input.rawPayload ?? undefined,
          paid_at: new Date(),
          updated_at: new Date()
        }
      })
      return
    }

    await tx.order_payments.update({
      where: { id: input.paymentId },
      data: {
        status: 'SUCCEEDED',
        provider_payment_id: input.providerPaymentId,
        raw_payload: input.rawPayload ?? undefined,
        paid_at: new Date(),
        updated_at: new Date()
      }
    })

    await tx.orders.update({
      where: { id: input.orderId },
      data: {
        status: 'PAID',
        payment_status: 'PAID',
        last_payment_error: null,
        updated_at: new Date()
      }
    })

    nextStatus = existingOrder.status

    await createOrderPaymentNotification({
      userId: existingOrder.user_id,
      orderId: input.orderId,
      type: 'ORDER_PAYMENT_SUCCEEDED',
      message: 'Ödemeniz başarıyla tamamlandı.'
    })
  })

  if (nextStatus && nextStatus !== 'PAID') {
    const order = await db.orders.findUnique({
      where: { id: input.orderId },
      select: { user_id: true }
    })

    await createOrderStatusNotification({
      userId: order?.user_id ?? null,
      orderId: input.orderId,
      previousStatus: nextStatus,
      nextStatus: 'PAID'
    })
  }
}

export async function markOrderPaymentFailed(input: {
  orderId: number
  paymentId: number
  failureReason?: string | null
  rawPayload?: Prisma.InputJsonValue
}): Promise<void> {
  await db.$transaction(async (tx) => {
    const existingOrder = await tx.orders.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        user_id: true
      }
    })

    if (!existingOrder) {
      throw new Error('ORDER_NOT_FOUND')
    }

    await tx.order_payments.update({
      where: { id: input.paymentId },
      data: {
        status: 'FAILED',
        failure_reason: input.failureReason,
        raw_payload: input.rawPayload ?? undefined,
        updated_at: new Date()
      }
    })

    if (existingOrder.status !== 'PAYMENT_FAILED') {
      await tx.orders.update({
        where: { id: input.orderId },
        data: {
          status: 'PAYMENT_FAILED',
          payment_status: 'FAILED',
          last_payment_error: input.failureReason || 'Payment failed.',
          updated_at: new Date()
        }
      })

      await releaseReservedStockForOrder(tx, input.orderId)
    }

    await createOrderPaymentNotification({
      userId: existingOrder.user_id,
      orderId: input.orderId,
      type: 'ORDER_PAYMENT_FAILED',
      message: input.failureReason || 'Ödeme doğrulanamadı.'
    })
  })
}

export async function markOrderPaymentPending(input: {
  orderId: number
  paymentId: number
  message?: string | null
  rawPayload?: Prisma.InputJsonValue
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.order_payments.update({
      where: { id: input.paymentId },
      data: {
        status: 'PENDING',
        failure_reason: input.message || null,
        raw_payload: input.rawPayload ?? undefined,
        updated_at: new Date()
      }
    })

    await tx.orders.update({
      where: { id: input.orderId },
      data: {
        status: 'PENDING_PAYMENT',
        payment_status: 'PENDING',
        last_payment_error: input.message || null,
        updated_at: new Date()
      }
    })
  })
}

function mapPaymentRow(
  row:
    | {
        id: number
        provider: string
        status: string
        amount: Prisma.Decimal
        currency: string
        provider_payment_id: string | null
        provider_conversation_id: string | null
        paid_at: Date | null
        failure_reason: string | null
        created_at: Date
        updated_at: Date
      }
    | undefined
    | null
): OrderPaymentView | null {
  if (!row) return null

  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    amount: decimalToNumber(row.amount),
    currency: row.currency,
    providerPaymentId: row.provider_payment_id,
    providerConversationId: row.provider_conversation_id,
    paidAt: row.paid_at?.toISOString() || null,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

function mapOrderRow(
  order: {
    id: number
    user_id: string | null
    guest_name: string | null
    guest_email: string | null
    guest_phone: string | null
    subtotal_amount: Prisma.Decimal
    shipping_fee: Prisma.Decimal
    total_amount: Prisma.Decimal
    currency: string
    status: string
    payment_status: string
    shipping_method: string | null
    payment_method: string | null
    shipping_address_json: Prisma.JsonValue | null
    note: string | null
    created_at: Date
    updated_at: Date
    users: {
      name: string
      email: string
    } | null
    order_items: Array<{
      id: number
      product_id: bigint
      product_name: string
      quantity: number
      price: Prisma.Decimal
      product: {
        part_no: string
      } | null
    }>
    order_payments: Array<{
      id: number
      provider: string
      status: string
      amount: Prisma.Decimal
      currency: string
      provider_payment_id: string | null
      provider_conversation_id: string | null
      paid_at: Date | null
      failure_reason: string | null
      created_at: Date
      updated_at: Date
    }>
  }
): OrderView {
  const items = order.order_items.map((item) => ({
    id: item.id,
    productId: item.product_id.toString(),
    // Sipariş anındaki ad; ürün sonradan yeniden adlandırılsa da sipariş değişmez.
    productName: item.product_name,
    partNo: item.product?.part_no || '-',
    quantity: item.quantity,
    price: decimalToNumber(item.price),
    lineTotal: decimalToNumber(item.price) * item.quantity
  }))

  return {
    id: order.id,
    orderNumber: formatOrderNumber(order.id),
    userId: order.user_id,
    guestName: order.guest_name,
    guestEmail: order.guest_email,
    guestPhone: order.guest_phone,
    customerName: order.users?.name || order.guest_name || 'Misafir Kullanıcı',
    customerEmail: order.users?.email || order.guest_email || null,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    shippingMethod: order.shipping_method,
    subtotalAmount: decimalToNumber(order.subtotal_amount),
    shippingFee: decimalToNumber(order.shipping_fee),
    totalAmount: decimalToNumber(order.total_amount),
    currency: order.currency,
    note: order.note,
    shippingAddress: (order.shipping_address_json as ShippingAddressInput | null) ?? null,
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
    itemsCount: order.order_items.length,
    items,
    latestPayment: mapPaymentRow(order.order_payments[0])
  }
}

export async function getOrderById(orderId: number): Promise<OrderView | null> {
  const order = await db.orders.findUnique({
    where: { id: orderId },
    include: {
      users: {
        select: {
          name: true,
          email: true
        }
      },
      order_items: {
        include: {
          product: {
            select: {
              part_no: true
            }
          }
        }
      },
      order_payments: {
        orderBy: {
          created_at: 'desc'
        },
        take: 1
      }
    }
  })

  return order ? mapOrderRow(order) : null
}

export async function getOrdersForUser(userId: string): Promise<OrderView[]> {
  const rows = await db.orders.findMany({
    where: {
      user_id: userId
    },
    orderBy: {
      created_at: 'desc'
    },
    include: {
      users: {
        select: {
          name: true,
          email: true
        }
      },
      order_items: {
        include: {
          product: {
            select: {
              part_no: true
            }
          }
        }
      },
      order_payments: {
        orderBy: {
          created_at: 'desc'
        },
        take: 1
      }
    }
  })

  return rows.map(mapOrderRow)
}

export async function getOrderForUser(
  userId: string,
  orderId: number
): Promise<OrderView | null> {
  const order = await db.orders.findFirst({
    where: {
      id: orderId,
      user_id: userId
    },
    include: {
      users: {
        select: {
          name: true,
          email: true
        }
      },
      order_items: {
        include: {
          product: {
            select: {
              part_no: true
            }
          }
        }
      },
      order_payments: {
        orderBy: {
          created_at: 'desc'
        },
        take: 1
      }
    }
  })

  return order ? mapOrderRow(order) : null
}

export async function lookupGuestOrder(
  orderNumber: string,
  email: string
): Promise<OrderView | null> {
  const orderId = parseOrderNumber(orderNumber)

  if (!orderId) {
    return null
  }

  const order = await db.orders.findFirst({
    where: {
      id: orderId,
      guest_email: {
        equals: email.trim(),
        mode: 'insensitive'
      }
    },
    include: {
      users: {
        select: {
          name: true,
          email: true
        }
      },
      order_items: {
        include: {
          product: {
            select: {
              part_no: true
            }
          }
        }
      },
      order_payments: {
        orderBy: {
          created_at: 'desc'
        },
        take: 1
      }
    }
  })

  return order ? mapOrderRow(order) : null
}

export async function getLatestPaymentForOrder(
  orderId: number
): Promise<{
  id: number
  order_id: number
  status: string
  provider_payment_id: string | null
}> {
  const payment = await db.order_payments.findFirst({
    where: {
      order_id: orderId
    },
    orderBy: {
      created_at: 'desc'
    },
    select: {
      id: true,
      order_id: true,
      status: true,
      provider_payment_id: true
    }
  })

  if (!payment) {
    throw new Error('PAYMENT_NOT_FOUND')
  }

  return payment
}

export async function updateOrderStatusWithPolicy(input: {
  orderId: number
  nextStatus: string
}): Promise<{ success: boolean; message: string }> {
  const nextStatus = input.nextStatus.trim().toUpperCase()
  if (!canAdminManageOrderStatus(nextStatus)) {
    return { success: false, message: 'Bu durum admin tarafından manuel güncellenemez.' }
  }

  const existing = await db.orders.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      status: true,
      user_id: true
    }
  })

  if (!existing) {
    return { success: false, message: 'Sipariş bulunamadı.' }
  }

  await db.$transaction(async (tx) => {
    await tx.orders.update({
      where: { id: input.orderId },
      data: {
        status: nextStatus,
        payment_status: nextStatus === 'REFUNDED' ? 'REFUNDED' : undefined,
        updated_at: new Date()
      }
    })

    if (shouldReleaseReservedStock(nextStatus)) {
      await releaseReservedStockForOrder(tx, input.orderId)
    }
  })

  await createOrderStatusNotification({
    userId: existing.user_id,
    orderId: input.orderId,
    previousStatus: existing.status,
    nextStatus
  })

  return { success: true, message: 'Sipariş durumu güncellendi.' }
}
