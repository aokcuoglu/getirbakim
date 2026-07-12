'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import { refreshSingleProductRollup } from '@/lib/catalog/refresh-product-rollups'
import {
  buildCatalogPrice,
  catalogProductHref,
  resolveCatalogName,
  CATALOG_VAT_RATE,
  decimalToNumber
} from '@/lib/catalog/store-view'
import type {
  AdminCatalogActionResult,
  AdminCatalogFilters,
  AdminCatalogListResult,
  AdminCatalogProductDetail,
  CatalogProductStatus,
  UpdateCatalogOverrideInput
} from '@/lib/types/admin-catalog'

const DEFAULT_LIMIT = 25
const STATUSES: CatalogProductStatus[] = ['ACTIVE', 'DRAFT', 'HIDDEN', 'ARCHIVED']

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function priceIncVat(exVat: number | null): number | null {
  return exVat == null ? null : Number((exVat * (1 + CATALOG_VAT_RATE)).toFixed(2))
}

function revalidateCatalogAdmin(slug?: string | null) {
  revalidatePath('/admin/catalog/products')
  revalidatePath('/tr/admin/catalog/products')
  revalidatePath('/en/admin/catalog/products')
  if (slug) {
    revalidatePath(`/tr/urun/${slug}`)
    revalidatePath(`/en/urun/${slug}`)
  }
}

function buildWhere(filters: AdminCatalogFilters): Prisma.productsWhereInput {
  const where: Prisma.productsWhereInput = {}

  if (filters.status && filters.status !== 'all') {
    where.status = filters.status
  }

  if (filters.stock === 'in') where.in_stock = true
  else if (filters.stock === 'out') where.in_stock = false

  const q = filters.q?.trim()
  if (q) {
    const qNorm = normalizeCode(q)
    const or: Prisma.productsWhereInput[] = [
      { part_no: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } }
    ]
    if (qNorm.length >= 2) {
      or.push({ part_no_norm: { startsWith: qNorm } })
      or.push({ product_oems: { some: { code_norm: qNorm } } })
    }
    where.OR = or
  }

  return where
}

function buildOrderBy(
  sort: AdminCatalogFilters['sort']
): Prisma.productsOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ min_selling_price_try: { sort: 'asc', nulls: 'last' } }]
    case 'price_desc':
      return [{ min_selling_price_try: { sort: 'desc', nulls: 'last' } }]
    case 'stock':
      return [{ total_stock_qty: 'desc' }]
    default:
      return [{ updated_at: 'desc' }]
  }
}

export async function getAdminCatalogProducts(
  input: AdminCatalogFilters = {}
): Promise<AdminCatalogListResult> {
  await requireAdminAuth()

  const page = Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Number(input.page) : 1
  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 100)
      : DEFAULT_LIMIT

  const where = buildWhere(input)
  const orderBy = buildOrderBy(input.sort)
  const offset = (page - 1) * limit

  const [rows, total, kpiTotal, kpiInStock, kpiPriced, kpiEnriched] = await Promise.all([
    db.products.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      select: {
        id: true,
        part_no: true,
        name: true,
        slug: true,
        status: true,
        min_selling_price_try: true,
        total_stock_qty: true,
        in_stock: true,
        offer_count: true,
        primary_part_id: true,
        updated_at: true,
        brand_list: { select: { brand: true } },
        part_categories: { select: { name: true } },
        product_overrides: {
          select: { lock_price: true, selling_price_override: true, name_override: true }
        }
      }
    }),
    db.products.count({ where }),
    db.products.count(),
    db.products.count({ where: { in_stock: true } }),
    db.products.count({ where: { min_selling_price_try: { not: null } } }),
    db.products.count({ where: { primary_part_id: { not: null } } })
  ])

  const products = rows.map((r) => {
    const sellingPriceExVat = decimalToNumber(r.min_selling_price_try)
    return {
      id: r.id.toString(),
      partNo: r.part_no,
      name: r.name,
      displayName: resolveCatalogName(r.name, r.product_overrides?.name_override),
      slug: r.slug,
      status: r.status as CatalogProductStatus,
      brandName: r.brand_list.brand,
      categoryName: r.part_categories?.name ?? null,
      sellingPriceExVat,
      priceIncVat: priceIncVat(sellingPriceExVat),
      totalStockQty: r.total_stock_qty,
      inStock: r.in_stock,
      offerCount: r.offer_count,
      isEnriched: r.primary_part_id != null,
      hasPriceOverride: r.product_overrides?.selling_price_override != null,
      lockPrice: r.product_overrides?.lock_price ?? false,
      href: r.slug ? catalogProductHref(r.slug) : null,
      updatedAt: r.updated_at?.toISOString?.() ?? new Date(0).toISOString()
    }
  })

  return {
    products,
    kpis: {
      totalProducts: kpiTotal,
      inStock: kpiInStock,
      priced: kpiPriced,
      enriched: kpiEnriched
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit))
    }
  }
}

export async function getAdminCatalogProductDetail(
  id: string
): Promise<AdminCatalogProductDetail | null> {
  await requireAdminAuth()

  let productId: bigint
  try {
    productId = BigInt(id)
  } catch {
    return null
  }

  const product = await db.products.findUnique({
    where: { id: productId },
    include: {
      brand_list: { select: { brand: true } },
      part_categories: { select: { id: true, name: true } },
      product_overrides: true,
      product_offers: {
        orderBy: [{ is_active: 'desc' }, { selling_price_try: 'asc' }],
        include: { suppliers: { select: { name: true } } }
      },
      product_oems: { orderBy: { id: 'asc' }, take: 200 },
      _count: {
        select: {
          product_eans: true,
          product_images: true,
          product_properties: true,
          product_vehicle_types: true
        }
      }
    }
  })

  if (!product) return null

  const override = product.product_overrides
  const categoryOverrideId = override?.category_override_id ?? null
  const categoryName = categoryOverrideId
    ? (
        await db.part_categories.findUnique({
          where: { id: categoryOverrideId },
          select: { name: true }
        })
      )?.name ?? null
    : product.part_categories?.name ?? null

  return {
    id: product.id.toString(),
    partNo: product.part_no,
    name: resolveCatalogName(product.name, override?.name_override),
    slug: product.slug,
    status: product.status as CatalogProductStatus,
    brandName: product.brand_list.brand,
    categoryId: categoryOverrideId ?? product.category_id,
    categoryName,
    primaryImageUrl: product.primary_image_url,
    primaryPartId: product.primary_part_id?.toString() ?? null,
    sellingPriceExVat: decimalToNumber(product.min_selling_price_try),
    totalStockQty: product.total_stock_qty,
    offerCount: product.offer_count,
    href: product.slug ? catalogProductHref(product.slug) : null,
    offers: product.product_offers.map((o) => ({
      id: o.id.toString(),
      supplierCode: o.supplier_code,
      supplierName: o.suppliers.name,
      supplierSku: o.supplier_sku,
      listPrice: decimalToNumber(o.list_price),
      costTry: decimalToNumber(o.cost_try),
      netCostTry: decimalToNumber(o.net_cost_try),
      sellingPriceTry: decimalToNumber(o.selling_price_try),
      currency: o.currency,
      stockQty: o.stock_qty,
      isActive: o.is_active,
      lastSyncedAt: o.last_synced_at?.toISOString() ?? null
    })),
    oems: product.product_oems.map((o) => ({
      code: o.code,
      brand: o.oem_brand,
      source: o.source
    })),
    eanCount: product._count.product_eans,
    imageCount: product._count.product_images,
    propertyCount: product._count.product_properties,
    vehicleCount: product._count.product_vehicle_types,
    override: override
      ? {
          sellingPriceOverride: decimalToNumber(override.selling_price_override),
          lockPrice: override.lock_price,
          nameOverride: override.name_override,
          categoryOverrideId: override.category_override_id,
          note: override.note,
          updatedBy: override.updated_by,
          updatedAt: override.updated_at?.toISOString() ?? null
        }
      : null,
    updatedAt: product.updated_at.toISOString()
  }
}

export async function updateCatalogProductOverride(
  input: UpdateCatalogOverrideInput
): Promise<AdminCatalogActionResult> {
  const auth = await requireAdminAuth()

  let productId: bigint
  try {
    productId = BigInt(input.id)
  } catch {
    return { success: false, message: 'Geçersiz ürün kimliği.' }
  }

  const product = await db.products.findUnique({
    where: { id: productId },
    select: { id: true, slug: true }
  })
  if (!product) {
    return { success: false, message: 'Ürün bulunamadı.' }
  }

  if (input.status && !STATUSES.includes(input.status)) {
    return { success: false, message: 'Geçersiz durum.' }
  }

  const priceOverride =
    input.sellingPriceOverride == null || Number.isNaN(input.sellingPriceOverride)
      ? null
      : Math.max(0, input.sellingPriceOverride)
  const lockPrice = Boolean(input.lockPrice)

  if (lockPrice && priceOverride == null) {
    return {
      success: false,
      message: 'Fiyatı kilitlemek için bir override fiyatı girin.'
    }
  }

  const nameOverride = input.nameOverride?.trim() || null
  const note = input.note?.trim() || null
  const editor = auth.user.email ?? auth.user.id

  await db.$transaction(async (tx) => {
    await tx.product_overrides.upsert({
      where: { product_id: productId },
      create: {
        product_id: productId,
        selling_price_override: priceOverride,
        lock_price: lockPrice,
        name_override: nameOverride,
        note,
        updated_by: editor
      },
      update: {
        selling_price_override: priceOverride,
        lock_price: lockPrice,
        name_override: nameOverride,
        note,
        updated_by: editor
      }
    })

    if (input.status) {
      await tx.products.update({
        where: { id: productId },
        data: { status: input.status }
      })
    }
  })

  // Recompute the rollup so the locked override price / stock cache is fresh.
  await refreshSingleProductRollup(productId)

  revalidateCatalogAdmin(product.slug)

  return { success: true, message: 'Ürün güncellendi.' }
}
