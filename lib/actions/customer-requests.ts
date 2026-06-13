'use server'

import { revalidatePath } from 'next/cache'
import { Prisma, type customer_requests } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import { getServerSession } from '@/lib/auth/server'
import {
  CUSTOMER_REQUEST_SOURCES,
  CUSTOMER_REQUEST_STATUSES,
  CUSTOMER_REQUEST_TYPES,
  type CreateCustomerRequestInput,
  type CustomerRequestDetail,
  type CustomerRequestFilters,
  type CustomerRequestListItem,
  type CustomerRequestMutationResult,
  type CustomerRequestsResult,
  type UpdateCustomerRequestInput
} from '@/lib/types/customer-requests'

const DEFAULT_LIMIT = 20

function revalidateCustomerRequests() {
  revalidatePath('/admin/requests')
  revalidatePath('/tr/admin/requests')
  revalidatePath('/en/admin/requests')
}

function normalizeText(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeCreateInput(input: CreateCustomerRequestInput) {
  return {
    requestType: input.requestType,
    source: input.source,
    name: input.name.trim(),
    email: input.email.trim(),
    phone: normalizeText(input.phone),
    partId:
      typeof input.partId === 'number' && Number.isInteger(input.partId) && input.partId > 0
        ? input.partId
        : null,
    partNameSnapshot: normalizeText(input.partNameSnapshot),
    brandNameSnapshot: normalizeText(input.brandNameSnapshot),
    categoryNameSnapshot: normalizeText(input.categoryNameSnapshot),
    pageUrl: normalizeText(input.pageUrl),
    locale: normalizeText(input.locale),
    vehicle: input.vehicle ?? null,
    searchQuery: normalizeText(input.searchQuery),
    requestedSkuOrOem: normalizeText(input.requestedSkuOrOem),
    message: normalizeText(input.message)
  }
}

function validateCreateInput(input: ReturnType<typeof normalizeCreateInput>) {
  if (!CUSTOMER_REQUEST_TYPES.includes(input.requestType)) {
    return 'Geçersiz talep tipi.'
  }

  if (!CUSTOMER_REQUEST_SOURCES.includes(input.source)) {
    return 'Geçersiz talep kaynağı.'
  }

  if (input.name.length < 2) {
    return 'Lütfen adınızı girin.'
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return 'Geçerli bir e-posta adresi girin.'
  }

  if (input.requestType === 'PRICE_REQUEST' && !input.partId) {
    return 'Fiyat talebi için ürün bilgisi eksik.'
  }

  if (input.requestType === 'PRODUCT_QUESTION' && !input.message) {
    return 'Sorunuzu girin.'
  }

  if (input.requestType === 'MISSING_PRODUCT' && !input.requestedSkuOrOem) {
    return 'Aradığınız ürün bilgisini girin.'
  }

  return null
}

function normalizeFilters(input: CustomerRequestFilters) {
  return {
    q: (input.q || '').trim(),
    type:
      input.type && (['all', ...CUSTOMER_REQUEST_TYPES] as string[]).includes(input.type)
        ? input.type
        : 'all',
    status:
      input.status &&
      (['all', ...CUSTOMER_REQUEST_STATUSES] as string[]).includes(input.status)
        ? input.status
        : 'all',
    source:
      input.source &&
      (['all', ...CUSTOMER_REQUEST_SOURCES] as string[]).includes(input.source)
        ? input.source
        : 'all',
    from: normalizeText(input.from) ?? '',
    to: normalizeText(input.to) ?? '',
    page:
      Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Number(input.page) : 1,
    limit:
      Number.isFinite(input.limit) && (input.limit ?? 0) > 0
        ? Math.min(Number(input.limit), 100)
        : DEFAULT_LIMIT
  }
}

function mapRequestRow(row: customer_requests): CustomerRequestDetail {
  return {
    id: row.id,
    requestType: row.request_type as CustomerRequestDetail['requestType'],
    status: row.status as CustomerRequestDetail['status'],
    source: row.source as CustomerRequestDetail['source'],
    name: row.name,
    email: row.email,
    phone: row.phone,
    partId: row.part_id ? Number(row.part_id) : null,
    partNameSnapshot: row.part_name_snapshot,
    brandNameSnapshot: row.brand_name_snapshot,
    categoryNameSnapshot: row.category_name_snapshot,
    pageUrl: row.page_url,
    locale: row.locale,
    vehicle:
      row.vehicle_json && typeof row.vehicle_json === 'object'
        ? (row.vehicle_json as CustomerRequestDetail['vehicle'])
        : null,
    searchQuery: row.search_query,
    requestedSkuOrOem: row.requested_sku_or_oem,
    message: row.message,
    adminNote: row.admin_note,
    assignedTo: row.assigned_to,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    userId: row.user_id
  }
}

export async function createCustomerRequest(
  input: CreateCustomerRequestInput
): Promise<CustomerRequestMutationResult<{ id: number }>> {
  const normalized = normalizeCreateInput(input)
  const validationError = validateCreateInput(normalized)

  if (validationError) {
    return { success: false, message: validationError }
  }

  let userId: string | null = null

  try {
    const session = await getServerSession()
    userId = session?.user?.id ?? null
  } catch {
    userId = null
  }

  const created = await db.customer_requests.create({
    data: {
      user_id: userId,
      request_type: normalized.requestType,
      status: 'NEW',
      source: normalized.source,
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      part_id: normalized.partId ? BigInt(normalized.partId) : null,
      part_name_snapshot: normalized.partNameSnapshot,
      brand_name_snapshot: normalized.brandNameSnapshot,
      category_name_snapshot: normalized.categoryNameSnapshot,
      page_url: normalized.pageUrl,
      locale: normalized.locale,
      vehicle_json: normalized.vehicle
        ? (normalized.vehicle as Prisma.InputJsonValue)
        : undefined,
      search_query: normalized.searchQuery,
      requested_sku_or_oem: normalized.requestedSkuOrOem,
      message: normalized.message
    },
    select: {
      id: true
    }
  })

  revalidateCustomerRequests()

  return {
    success: true,
    message: 'Talebiniz alındı. En kısa sürede sizinle iletişime geçeceğiz.',
    data: { id: created.id }
  }
}

export async function getAdminCustomerRequests(
  input: CustomerRequestFilters = {}
): Promise<CustomerRequestsResult> {
  await requireAdminAuth()

  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit

  const andConditions: Record<string, unknown>[] = []

  if (filters.type !== 'all') {
    andConditions.push({ request_type: filters.type })
  }

  if (filters.status !== 'all') {
    andConditions.push({ status: filters.status })
  }

  if (filters.source !== 'all') {
    andConditions.push({ source: filters.source })
  }

  if (filters.from || filters.to) {
    andConditions.push({
      created_at: {
        ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
        ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {})
      }
    })
  }

  if (filters.q) {
    andConditions.push({
      OR: [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
        { phone: { contains: filters.q, mode: 'insensitive' } },
        { message: { contains: filters.q, mode: 'insensitive' } },
        { part_name_snapshot: { contains: filters.q, mode: 'insensitive' } },
        { brand_name_snapshot: { contains: filters.q, mode: 'insensitive' } },
        { category_name_snapshot: { contains: filters.q, mode: 'insensitive' } },
        { requested_sku_or_oem: { contains: filters.q, mode: 'insensitive' } },
        { search_query: { contains: filters.q, mode: 'insensitive' } }
      ]
    })
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : undefined

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [rows, total, openTotal, newToday, priceRequestsOpen, productQuestionsOpen, missingProductsOpen] =
    await Promise.all([
      db.customer_requests.findMany({
        where,
        take: filters.limit,
        skip: offset,
        orderBy: { created_at: 'desc' }
      }),
      db.customer_requests.count({ where }),
      db.customer_requests.count({
        where: {
          status: {
            in: ['NEW', 'IN_REVIEW']
          }
        }
      }),
      db.customer_requests.count({
        where: {
          created_at: {
            gte: startOfToday
          }
        }
      }),
      db.customer_requests.count({
        where: {
          request_type: 'PRICE_REQUEST',
          status: {
            in: ['NEW', 'IN_REVIEW']
          }
        }
      }),
      db.customer_requests.count({
        where: {
          request_type: 'PRODUCT_QUESTION',
          status: {
            in: ['NEW', 'IN_REVIEW']
          }
        }
      }),
      db.customer_requests.count({
        where: {
          request_type: 'MISSING_PRODUCT',
          status: {
            in: ['NEW', 'IN_REVIEW']
          }
        }
      })
    ])

  return {
    filters,
    requests: rows.map((row) => mapRequestRow(row)),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(Math.ceil(total / filters.limit), 1)
    },
    kpis: {
      openTotal,
      newToday,
      priceRequestsOpen,
      productQuestionsOpen,
      missingProductsOpen
    }
  }
}

export async function getAdminCustomerRequestDetail(
  id: number
): Promise<CustomerRequestMutationResult<CustomerRequestDetail>> {
  await requireAdminAuth()

  const row = await db.customer_requests.findUnique({
    where: { id }
  })

  if (!row) {
    return { success: false, message: 'Talep bulunamadı.' }
  }

  return {
    success: true,
    message: 'Talep detayı yüklendi.',
    data: mapRequestRow(row)
  }
}

export async function updateAdminCustomerRequest(
  input: UpdateCustomerRequestInput
): Promise<CustomerRequestMutationResult> {
  await requireAdminAuth()

  const data: {
    status?: string
    admin_note?: string | null
    resolved_at?: Date | null
  } = {}

  if (input.status) {
    if (!CUSTOMER_REQUEST_STATUSES.includes(input.status)) {
      return { success: false, message: 'Geçersiz durum.' }
    }

    data.status = input.status
    data.resolved_at = input.status === 'RESOLVED' ? new Date() : null
  }

  if (typeof input.adminNote === 'string') {
    data.admin_note = normalizeText(input.adminNote)
  }

  if (Object.keys(data).length === 0) {
    return { success: false, message: 'Güncellenecek alan bulunamadı.' }
  }

  await db.customer_requests.update({
    where: { id: input.id },
    data
  })

  revalidateCustomerRequests()

  return {
    success: true,
    message: 'Talep kaydı güncellendi.'
  }
}
