'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import type {
  AdminCustomerDetail,
  AdminCustomerFilters,
  AdminCustomerListItem,
  AdminCustomersResult
} from '@/lib/types/admin-customers'

const DEFAULT_LIMIT = 20

function normalizeFilters(input: AdminCustomerFilters): Required<AdminCustomerFilters> {
  const page = Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Number(input.page) : 1
  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 100)
      : DEFAULT_LIMIT

  return {
    q: (input.q || '').trim(),
    role: input.role || 'all',
    page,
    limit
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function revalidateAdminCustomers() {
  revalidatePath('/admin/customers')
  revalidatePath('/tr/admin/customers')
  revalidatePath('/en/admin/customers')
}

export async function getAdminCustomers(
  input: AdminCustomerFilters = {}
): Promise<AdminCustomersResult> {
  await requireAdminAuth()

  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit

  const whereCondition: {
    role?: string
    OR?: Array<
      | { name: { contains: string; mode: 'insensitive' } }
      | { email: { contains: string; mode: 'insensitive' } }
    >
  } = {}

  if (filters.role !== 'all') {
    whereCondition.role = filters.role
  }

  if (filters.q) {
    whereCondition.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { email: { contains: filters.q, mode: 'insensitive' } }
    ]
  }

  const [users, totalCount, roleAndVerifiedCounts] = await Promise.all([
    db.users.findMany({
      where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
      take: filters.limit,
      skip: offset,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        email_verified: true,
        image: true,
        created_at: true,
        updated_at: true
      }
    }),
    db.users.count({
      where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined
    }),
    db.users.groupBy({
      by: ['role', 'email_verified'],
      _count: { _all: true }
    })
  ])

  let allCustomersCount = 0
  let adminCount = 0
  let verifiedCount = 0

  for (const row of roleAndVerifiedCounts) {
    const count = row._count._all
    allCustomersCount += count
    if (row.role === 'ADMIN') adminCount += count
    if (row.email_verified === true) verifiedCount += count
  }

  const userIds = users.map((user) => user.id)

  const orderAgg = userIds.length
    ? await db.orders.groupBy({
        by: ['user_id'],
        where: { user_id: { in: userIds } },
        _count: { _all: true },
        _sum: { total_amount: true },
        _max: { created_at: true }
      })
    : []

  const aggMap = new Map(
    orderAgg.map((item) => [
      item.user_id,
      {
        count: item._count._all,
        total: toNumber(item._sum.total_amount, 0),
        lastOrderAt: item._max.created_at?.toISOString() || null
      }
    ])
  )

  const customers: AdminCustomerListItem[] = users.map((user) => {
    const agg = aggMap.get(user.id)
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'CUSTOMER',
      emailVerified: user.email_verified,
      image: user.image,
      createdAt: user.created_at.toISOString(),
      ordersCount: agg?.count || 0,
      totalSpent: agg?.total || 0,
      lastOrderAt: agg?.lastOrderAt || null
    }
  })

  const activeCustomers = customers.filter((item) => item.ordersCount > 0).length

  return {
    filters,
    customers,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: totalCount,
      pages: Math.max(Math.ceil(totalCount / filters.limit), 1)
    },
    kpis: {
      totalCustomers: allCustomersCount,
      adminUsers: adminCount,
      verifiedCustomers: verifiedCount,
      activeCustomers
    }
  }
}

export async function getAdminCustomerDetail(userId: string): Promise<{
  success: boolean
  message?: string
  data?: AdminCustomerDetail
}> {
  await requireAdminAuth()

  const user = await db.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      email_verified: true,
      image: true,
      created_at: true,
      updated_at: true,
      orders: {
        orderBy: { created_at: 'desc' },
        take: 20,
        include: {
          _count: { select: { order_items: true } }
        }
      },
      user_vehicles: {
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          created_at: true,
          vehicle_data: true
        }
      }
    }
  })

  if (!user) {
    return { success: false, message: 'Müşteri bulunamadı.' }
  }

  const ordersCount = user.orders.length
  const totalSpent = user.orders.reduce(
    (sum, order) => sum + toNumber(order.total_amount, 0),
    0
  )

  const detail: AdminCustomerDetail = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'CUSTOMER',
    emailVerified: user.email_verified,
    image: user.image,
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString(),
    ordersCount,
    totalSpent,
    lastOrderAt: user.orders[0]?.created_at?.toISOString() || null,
    orders: user.orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: toNumber(order.total_amount, 0),
      createdAt: order.created_at.toISOString(),
      itemsCount: order._count.order_items
    })),
    vehicles: user.user_vehicles.map((vehicle) => ({
      id: vehicle.id,
      createdAt: vehicle.created_at?.toISOString() || null,
      vehicleData: vehicle.vehicle_data
    }))
  }

  return { success: true, data: detail }
}

export async function updateCustomerRole(input: {
  userId: string
  role: 'ADMIN' | 'CUSTOMER'
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  await db.users.update({
    where: { id: input.userId },
    data: { role: input.role }
  })

  revalidateAdminCustomers()
  return { success: true, message: 'Müşteri rolü güncellendi.' }
}

export async function bulkUpdateCustomerRole(input: {
  userIds: string[]
  role: 'ADMIN' | 'CUSTOMER'
}): Promise<{ success: boolean; message: string; affected: number }> {
  await requireAdminAuth()

  const userIds = Array.from(new Set(input.userIds.filter(Boolean)))
  if (userIds.length === 0) {
    return { success: false, message: 'Toplu işlem için müşteri seçilmedi.', affected: 0 }
  }

  const result = await db.users.updateMany({
    where: { id: { in: userIds } },
    data: { role: input.role }
  })

  revalidateAdminCustomers()
  return {
    success: true,
    message: 'Toplu rol güncellemesi tamamlandı.',
    affected: result.count
  }
}
