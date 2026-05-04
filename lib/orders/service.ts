import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderStatusNotification, createUserNotifications } from '@/lib/notifications/server'
import { resolveRealPriceExVat } from '@/lib/pricing/public-pricing'
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

type CheckoutPartRecord = {
  id: bigint
  name: string
  price: Prisma.Decimal | null
  part_categories: { name: string } | null
  part_pricing_inventory: {
    supplier_stock_qty: number | null
    reserved_stock_qty: number | null
    supplier_price: Prisma.Decimal | null
    computed_selling_price_ex_vat: Prisma.Decimal | null
  } | null
  part_admin_overrides: {
    lock_price: boolean | null
    selling_price_override: Prisma.Decimal | null
  } | null
}

export type CheckoutIssue = {
  partId: number
  reason: 'NOT_FOUND' | 'PRICE_UNAVAILABLE' | 'OUT_OF_STOCK'
  message: string
}

export interface PreparedCheckoutLine {
  partId: number
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
  items: Array<{ partId: number; quantity: number }>
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
  partId: string
  productName: string
  articleLinkId: string
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

export function resolveDisplayUnitPrice(part: CheckoutPartRecord): Prisma.Decimal | null {
  const base = resolveRealPriceExVat(part)
  return toVatIncludedDecimal(base)
}

export async function prepareCheckoutLines(
  items: Array<{ partId: number; quantity: number }>
): Promise<{ issues: CheckoutIssue[]; lines: PreparedCheckoutLine[] }> {
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
      part_categories: {
        select: {
          name: true
        }
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

  const byId = new Map(parts.map((part) => [Number(part.id), part]))
  const issues: CheckoutIssue[] = []
  const lines: PreparedCheckoutLine[] = []

  for (const item of items) {
    const part = byId.get(item.partId)
    if (!part) {
      issues.push({
        partId: item.partId,
        reason: 'NOT_FOUND',
        message: `Part ${item.partId} could not be found.`
      })
      continue
    }

    const unitPrice = resolveDisplayUnitPrice(part)
    if (!unitPrice) {
      issues.push({
        partId: item.partId,
        reason: 'PRICE_UNAVAILABLE',
        message: `Part ${item.partId} has no valid checkout price.`
      })
      continue
    }

    const inventory = part.part_pricing_inventory
    const stockQty = inventory?.supplier_stock_qty ?? 0
    const reservedQty = inventory?.reserved_stock_qty ?? 0
    const hasLiveStock = stockQty > 0
    const available = Math.max(stockQty - reservedQty, 0)

    if (hasLiveStock && available < item.quantity) {
      issues.push({
        partId: item.partId,
        reason: 'OUT_OF_STOCK',
        message: `Part ${item.partId} does not have enough stock for quantity ${item.quantity}.`
      })
      continue
    }

    lines.push({
      partId: item.partId,
      name: part.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice.mul(item.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      hasLiveStock,
      categoryName: part.part_categories?.name || null
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
        part_id: BigInt(item.partId),
        quantity: item.quantity,
        price: item.unitPrice
      }))
    })

    for (const item of lines) {
      if (!item.hasLiveStock) continue

      await tx.part_pricing_inventory.updateMany({
        where: { part_id: BigInt(item.partId) },
        data: {
          reserved_stock_qty: {
            increment: item.quantity
          }
        }
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
      stock_released_at: true,
      order_items: {
        select: {
          part_id: true,
          quantity: true
        }
      }
    }
  })

  if (!order || order.stock_released_at) {
    return false
  }

  for (const item of order.order_items) {
    // Clamp reserved stock at zero while releasing inventory for failed/cancelled flows.
    await tx.$executeRaw`
      UPDATE part_pricing_inventory
      SET reserved_stock_qty = GREATEST(COALESCE(reserved_stock_qty, 0) - ${item.quantity}, 0)
      WHERE part_id = ${item.part_id}
    `
  }

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
      part_id: bigint
      quantity: number
      price: Prisma.Decimal
      parts: {
        name: string
        article_link_id: bigint
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
    partId: item.part_id.toString(),
    productName: item.parts?.name || 'Unknown Product',
    articleLinkId: item.parts?.article_link_id?.toString() || '-',
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
          parts: {
            select: {
              name: true,
              article_link_id: true
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
          parts: {
            select: {
              name: true,
              article_link_id: true
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
          parts: {
            select: {
              name: true,
              article_link_id: true
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
          parts: {
            select: {
              name: true,
              article_link_id: true
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
