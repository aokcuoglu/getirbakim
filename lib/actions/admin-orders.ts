'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import {
  canAdminManageOrderStatus,
  formatOrderNumber
} from '@/lib/orders/types'
import { getOrderById, updateOrderStatusWithPolicy } from '@/lib/orders/service'
import type {
  AdminOrderDetail,
  AdminOrderFilters,
  AdminOrderListItem,
  AdminOrdersResult
} from '@/lib/types/admin-orders'

const DEFAULT_LIMIT = 20

function normalizeFilters(input: AdminOrderFilters): Required<AdminOrderFilters> {
  const page = Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Number(input.page) : 1
  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 100)
      : DEFAULT_LIMIT

  return {
    q: (input.q || '').trim(),
    status: input.status || 'all',
    page,
    limit
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function revalidateAdminOrders() {
  revalidatePath('/admin/orders')
  revalidatePath('/tr/admin/orders')
  revalidatePath('/en/admin/orders')
  revalidatePath('/admin')
  revalidatePath('/tr/admin')
  revalidatePath('/en/admin')
}

export async function getAdminOrders(
  input: AdminOrderFilters = {}
): Promise<AdminOrdersResult> {
  await requireAdminAuth()

  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit

  const whereCondition: {
    status?: string
    OR?: Array<
      | { users: { name: { contains: string; mode: 'insensitive' } } }
      | { users: { email: { contains: string; mode: 'insensitive' } } }
      | { guest_name: { contains: string; mode: 'insensitive' } }
      | { guest_email: { contains: string; mode: 'insensitive' } }
      | { id: number }
    >
  } = {}

  if (filters.status !== 'all') {
    whereCondition.status = filters.status
  }

  if (filters.q) {
    const numericId = Number(filters.q)
    const orConditions: Array<
      | { users: { name: { contains: string; mode: 'insensitive' } } }
      | { users: { email: { contains: string; mode: 'insensitive' } } }
      | { guest_name: { contains: string; mode: 'insensitive' } }
      | { guest_email: { contains: string; mode: 'insensitive' } }
      | { id: number }
    > = [
      { users: { name: { contains: filters.q, mode: 'insensitive' } } },
      { users: { email: { contains: filters.q, mode: 'insensitive' } } },
      { guest_name: { contains: filters.q, mode: 'insensitive' } },
      { guest_email: { contains: filters.q, mode: 'insensitive' } }
    ]

    if (Number.isInteger(numericId) && numericId > 0) {
      orConditions.push({ id: numericId })
    }

    whereCondition.OR = orConditions
  }

  const [orders, totalCount, pendingCount, completedCount, cancelledCount] =
    await Promise.all([
      db.orders.findMany({
        where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
        take: filters.limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: {
              name: true,
              email: true
            }
          },
          _count: {
            select: {
              order_items: true
            }
          }
        }
      }),
      db.orders.count({
        where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined
      }),
      db.orders.count({ where: { status: 'PENDING_PAYMENT' } }),
      db.orders.count({ where: { status: 'COMPLETED' } }),
      db.orders.count({ where: { status: { in: ['CANCELLED', 'REFUNDED', 'PAYMENT_FAILED'] } } })
    ])

  const mappedOrders: AdminOrderListItem[] = orders.map((order) => ({
    id: order.id,
    orderNumber: formatOrderNumber(order.id),
    userId: order.user_id,
    guestName: order.guest_name,
    guestEmail: order.guest_email,
    guestPhone: order.guest_phone,
    customerName: order.users?.name || order.guest_name || 'Misafir Kullanıcı',
    customerEmail: order.users?.email || order.guest_email || null,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    totalAmount: toNumber(order.total_amount, 0),
    status: order.status,
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
    itemsCount: order._count.order_items
  }))

  return {
    filters,
    orders: mappedOrders,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: totalCount,
      pages: Math.max(Math.ceil(totalCount / filters.limit), 1)
    },
    kpis: {
      totalOrders: totalCount,
      pendingOrders: pendingCount,
      completedOrders: completedCount,
      cancelledOrders: cancelledCount
    }
  }
}

export async function getAdminOrderDetail(orderId: number): Promise<{
  success: boolean
  message?: string
  data?: AdminOrderDetail
}> {
  await requireAdminAuth()

  const order = await getOrderById(orderId)
  if (!order) {
    return { success: false, message: 'Sipariş bulunamadı.' }
  }

  const detail: AdminOrderDetail = {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    guestName: order.guestName,
    guestEmail: order.guestEmail,
    guestPhone: order.guestPhone,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    shippingMethod: order.shippingMethod,
    subtotalAmount: order.subtotalAmount,
    shippingFee: order.shippingFee,
    note: order.note,
    totalAmount: order.totalAmount,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    latestPayment: order.latestPayment
      ? {
          provider: order.latestPayment.provider,
          status: order.latestPayment.status,
          providerPaymentId: order.latestPayment.providerPaymentId,
          paidAt: order.latestPayment.paidAt,
          failureReason: order.latestPayment.failureReason
        }
      : null,
    items: order.items,
    summary: {
      itemsTotal: order.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0)
    }
  }

  return { success: true, data: detail }
}

export async function updateOrderStatus(input: {
  orderId: number
  status: string
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  const status = input.status.trim().toUpperCase()
  const result = await updateOrderStatusWithPolicy({
    orderId: input.orderId,
    nextStatus: status
  })
  revalidateAdminOrders()
  return result
}

export async function bulkUpdateOrderStatus(input: {
  orderIds: number[]
  status: string
}): Promise<{ success: boolean; message: string; affected: number }> {
  await requireAdminAuth()

  const orderIds = Array.from(
    new Set(input.orderIds.filter((id) => Number.isInteger(id) && id > 0))
  )

  if (orderIds.length === 0) {
    return { success: false, message: 'Toplu işlem için sipariş seçilmedi.', affected: 0 }
  }

  const status = input.status.trim().toUpperCase()
  if (!status) {
    return { success: false, message: 'Durum alanı boş olamaz.', affected: 0 }
  }
  if (!canAdminManageOrderStatus(status)) {
    return {
      success: false,
      message: 'Bu durum toplu olarak manuel yönetilemez.',
      affected: 0
    }
  }

  const results = await Promise.all(
    orderIds.map((orderId) =>
      updateOrderStatusWithPolicy({
        orderId,
        nextStatus: status
      })
    )
  )
  const affected = results.filter((item) => item.success).length

  revalidateAdminOrders()
  return {
    success: affected > 0,
    message:
      affected > 0
        ? 'Toplu sipariş güncellemesi tamamlandı.'
        : 'Seçili siparişler güncellenemedi.',
    affected
  }
}
