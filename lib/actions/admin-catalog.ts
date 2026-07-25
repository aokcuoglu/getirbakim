'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import { refreshSingleProductRollup } from '@/lib/catalog/refresh-product-rollups'
import { getConfirmedPartIds } from '@/lib/catalog/part-enrichment'
import { syncProductSearchDocument } from '@/lib/search/sync-product-document'
import {
  getCatalogEnrichmentCoverage,
  type CatalogEnrichmentCoverage
} from '@/lib/admin/catalog-enrichment-stats'
import {
  buildCatalogPrice,
  catalogProductHref,
  resolveCatalogName,
  CATALOG_VAT_RATE,
  decimalToNumber
} from '@/lib/catalog/store-view'
import { normalizeOem, parseOemEntries } from '@/lib/matching/code-normalization'
import { canonicalNameSql, canonicalOverrideJoin } from '@/lib/catalog/canonical-name-sql'
import type {
  AdminCatalogActionResult,
  AdminCatalogFilters,
  AdminCatalogImage,
  AdminCatalogListResult,
  AdminCatalogProductDetail,
  AdminCatalogProperty,
  CatalogProductStatus,
  MutateProductCodeInput,
  MutateProductEanResult,
  MutateProductImageResult,
  MutateProductOemResult,
  MutateProductPropertyInput,
  MutateProductPropertyResult,
  UpdateCatalogOverrideInput
} from '@/lib/types/admin-catalog'

const DEFAULT_LIMIT = 25
const STATUSES: CatalogProductStatus[] = ['ACTIVE', 'DRAFT', 'HIDDEN', 'ARCHIVED']
/** Tek server action çağrısında incelenebilecek en fazla web önerisi. */
const MAX_REVIEW_BATCH = 300
/** Filtreye göre toplu onayda tek çağrıda işlenen öneri sayısı. */
const MAX_BULK_BATCH = 500

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function priceIncVat(exVat: number | null): number | null {
  return exVat == null ? null : Number((exVat * (1 + CATALOG_VAT_RATE)).toFixed(2))
}

function revalidateCatalogAdmin(slug?: string | null) {
  revalidatePath('/admin/products')
  revalidatePath('/tr/admin/products')
  revalidatePath('/en/admin/products')
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
        brand: { select: { brand: true } },
        category: { select: { name: true } },
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
      brandName: r.brand.brand,
      categoryName: r.category?.name ?? null,
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
      brand: { select: { brand: true } },
      category: { select: { id: true, name: true } },
      product_overrides: true,
      product_offers: {
        orderBy: [{ is_active: 'desc' }, { selling_price_try: 'asc' }],
        include: { supplier: { select: { name: true } } }
      },
      // Limit, marka varyantlarını da barındırmalı: tek bir OEM kodu bir araç
      // markası grubunun her markası için ayrı satır taşıyabilir.
      product_oems: { orderBy: { id: 'asc' }, take: 600 },
      product_eans: {
        orderBy: { id: 'asc' },
        take: 200,
        select: { code: true, source: true }
      }
    }
  })

  if (!product) return null

  // Görsel/özellik iki kaynaktan gelir: admin'in elle girdiği catalog.product_*
  // satırları ve onaylanmış product_part_links üzerinden public.part_*'tan
  // devralınanlar. Araç uyumluluğu yalnız devralınır (part_vehicle_types).
  const partIds = await getConfirmedPartIds(product.id)
  const [images, properties, vehicleCount] = await Promise.all([
    loadProductImages(product.id, product.primary_image_url, partIds),
    loadProductProperties(product.id, partIds),
    partIds.length
      ? db.part_vehicle_types.count({ where: { part_id: { in: partIds } } })
      : Promise.resolve(0)
  ])

  const override = product.product_overrides
  const categoryOverrideId = override?.category_override_id ?? null
  const categoryName = categoryOverrideId
    ? (
        await db.part_categories.findUnique({
          where: { id: categoryOverrideId },
          select: { name: true }
        })
      )?.name ?? null
    : product.category?.name ?? null

  return {
    id: product.id.toString(),
    partNo: product.part_no,
    name: resolveCatalogName(product.name, override?.name_override),
    slug: product.slug,
    status: product.status as CatalogProductStatus,
    brandName: product.brand.brand,
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
      supplierName: o.supplier.name,
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
      brand: o.oem_brand || null,
      source: o.source
    })),
    eans: product.product_eans.map((e) => ({ code: e.code, source: e.source })),
    images,
    properties,
    imageCount: images.length,
    propertyCount: properties.length,
    vehicleCount,
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
  // Arama indeksi de yeni adı/fiyatı görsün (Meili kapalıysa no-op).
  await syncProductSearchDocument(productId)

  revalidateCatalogAdmin(product.slug)

  return { success: true, message: 'Ürün güncellendi.' }
}

// ----------------------------------------------------------------------------
// Manual OEM / EAN enrichment — the identifier pool that feeds public.parts
// matching (catalog.product_oems.code_norm ↔ public.part_oens.code). Admin
// adds/removes MANUAL entries live from the product detail sheet; supplier-
// sourced rows (DNMK/BSBG/PARTS) are read-only here and regenerated by sync.
// ----------------------------------------------------------------------------

/** Ürünü id + slug ile bulur (mutasyon guard'ı + revalidate için). */
async function findProductForCode(
  id: string
): Promise<{ productId: bigint; slug: string | null } | null> {
  let productId: bigint
  try {
    productId = BigInt(id)
  } catch {
    return null
  }
  const product = await db.products.findUnique({
    where: { id: productId },
    select: { id: true, slug: true }
  })
  if (!product) return null
  return { productId, slug: product.slug }
}

/** Ürünün güncel OEM havuzunu (detay dönüşüyle aynı şekil) getirir. */
async function loadProductOems(
  productId: bigint
): Promise<MutateProductOemResult['oems']> {
  const rows = await db.product_oems.findMany({
    where: { product_id: productId },
    orderBy: { id: 'asc' },
    take: 600,
    select: { code: true, oem_brand: true, source: true }
  })
  return rows.map((o) => ({ code: o.code, brand: o.oem_brand || null, source: o.source }))
}

/** Ürünün güncel EAN listesini getirir. */
async function loadProductEans(
  productId: bigint
): Promise<MutateProductEanResult['eans']> {
  const rows = await db.product_eans.findMany({
    where: { product_id: productId },
    orderBy: { id: 'asc' },
    take: 200,
    select: { code: true, source: true }
  })
  return rows.map((e) => ({ code: e.code, source: e.source }))
}

/**
 * Manuel OEM / çapraz referans ekler (source='MANUAL'). Girdi virgül/newline ile
 * ayrılmış birden çok «MARKA KOD» kaydı olabilir (ör. "DAF 1812163, SCANIA
 * 2043169"); her kayıt public.part_oens biçiminde (ayrı oem_brand + biçimli code
 * + eşleştirme için code_norm) saklanır. code_norm, tedarikçi satırlarını
 * kanonik ürüne bağlayan OEM örtüşmesini besler (match-supplier-rows.ts
 * rung 2a/2b).
 */
export async function addCatalogProductOem(
  input: MutateProductCodeInput
): Promise<MutateProductOemResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', oems: [] }

  const parsed = parseOemEntries(input.code)
  if (parsed.length === 0) {
    return {
      success: false,
      message: 'Geçerli bir OEM / çapraz numara girin (ör. DAF 1812163).',
      oems: await loadProductOems(product.productId)
    }
  }

  const values = parsed.map(
    (p) =>
      Prisma.sql`(${product.productId}, ${p.code}, ${p.codeNorm}, ${p.brand?.trim() ?? ''}, 'MANUAL')`
  )
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, oem_brand, source)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (product_id, code_norm, oem_brand) DO NOTHING
  `)

  revalidateCatalogAdmin(product.slug)
  const n = Number(inserted)
  return {
    success: true,
    message: n > 0 ? `${n} OEM eklendi.` : 'Yeni OEM eklenmedi (zaten mevcut).',
    oems: await loadProductOems(product.productId)
  }
}

/**
 * Yalnızca MANUAL kaynaklı bir OEM'i siler. `brand` verilirse yalnız o marka
 * varyantını hedefler — aynı kod birden çok araç markası altında ayrı satır
 * olarak durabildiği için (unique key: product_id + code_norm + oem_brand),
 * markasız silme kodun tüm varyantlarını süpürürdü.
 */
export async function removeCatalogProductOem(
  input: MutateProductCodeInput
): Promise<MutateProductOemResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', oems: [] }

  const codeNorm = normalizeOem(input.code)
  if (!codeNorm) {
    return {
      success: false,
      message: 'Geçersiz kod.',
      oems: await loadProductOems(product.productId)
    }
  }

  const brandFilter =
    input.brand === undefined
      ? Prisma.empty
      : Prisma.sql`AND oem_brand = ${input.brand?.trim() ?? ''}`

  // MANUAL (elle girilen) ve WEB (onaylanmış web önerisi) satırları silinebilir;
  // DNMK/BSBG/PARTS tedarikçi/TecDoc türevi olduğu için sync tarafından yeniden
  // üretilir, buradan silmek anlamsız olurdu.
  await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.product_oems
    WHERE product_id = ${product.productId} AND code_norm = ${codeNorm}
      AND source IN ('MANUAL', 'WEB')
      ${brandFilter}
  `)

  revalidateCatalogAdmin(product.slug)
  return {
    success: true,
    message: 'OEM kaldırıldı.',
    oems: await loadProductOems(product.productId)
  }
}

/** Manuel EAN / barkod ekler (source='MANUAL'). Virgül/newline ile çoklu kod. */
export async function addCatalogProductEan(
  input: MutateProductCodeInput
): Promise<MutateProductEanResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', eans: [] }

  const codes = Array.from(
    new Set(
      input.code
        .split(/[,\n;]+/)
        .map((c) => c.trim())
        .filter((c) => c.length >= 3)
    )
  )
  if (codes.length === 0) {
    return {
      success: false,
      message: 'Geçerli bir EAN / barkod girin (en az 3 karakter).',
      eans: await loadProductEans(product.productId)
    }
  }

  const values = codes.map((c) => Prisma.sql`(${product.productId}, ${c}, 'MANUAL')`)
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_eans (product_id, code, source)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (product_id, code) DO NOTHING
  `)

  revalidateCatalogAdmin(product.slug)
  const n = Number(inserted)
  return {
    success: true,
    message: n > 0 ? `${n} EAN eklendi.` : 'Yeni EAN eklenmedi (zaten mevcut).',
    eans: await loadProductEans(product.productId)
  }
}

/** Yalnızca MANUAL kaynaklı bir EAN'i siler. */
export async function removeCatalogProductEan(
  input: MutateProductCodeInput
): Promise<MutateProductEanResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', eans: [] }

  const code = input.code.trim()
  await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.product_eans
    WHERE product_id = ${product.productId} AND code = ${code} AND source = 'MANUAL'
  `)

  revalidateCatalogAdmin(product.slug)
  return {
    success: true,
    message: 'EAN kaldırıldı.',
    eans: await loadProductEans(product.productId)
  }
}

// ----------------------------------------------------------------------------
// Manuel görsel + teknik özellik
//
// İki katman birlikte gösterilir:
//   • catalog.product_images / product_properties → admin'in elle girdiği,
//     silinebilir satırlar (source='MANUAL'); sync bunlara dokunmaz.
//   • public.part_images / part_properties        → onaylı product_part_links
//     üzerinden devralınan TecDoc verisi; salt-okunur (id'siz döner).
// Aynı URL / aynı key iki katmanda da varsa manuel satır kazanır.
// ----------------------------------------------------------------------------

const IMAGE_TAKE = 60
const PROPERTY_TAKE = 120

async function loadProductImages(
  productId: bigint,
  primaryImageUrl: string | null,
  partIds: bigint[]
): Promise<AdminCatalogImage[]> {
  const [own, inherited] = await Promise.all([
    db.product_images.findMany({
      where: { product_id: productId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: IMAGE_TAKE,
      select: { id: true, url: true, thumb: true, position: true, source: true }
    }),
    partIds.length
      ? db.part_images.findMany({
          where: { part_id: { in: partIds } },
          orderBy: { id: 'asc' },
          take: IMAGE_TAKE,
          select: { image: true, thumb: true }
        })
      : Promise.resolve([])
  ])

  const seen = new Set<string>()
  const images: AdminCatalogImage[] = []

  for (const row of own) {
    if (!row.url || seen.has(row.url)) continue
    seen.add(row.url)
    images.push({
      id: row.id.toString(),
      url: row.url,
      thumb: row.thumb,
      position: row.position,
      source: row.source,
      isPrimary: row.url === primaryImageUrl
    })
  }
  for (const row of inherited) {
    if (!row.image || seen.has(row.image)) continue
    seen.add(row.image)
    images.push({
      id: null,
      url: row.image,
      thumb: row.thumb,
      position: 0,
      source: 'PARTS',
      isPrimary: row.image === primaryImageUrl
    })
  }

  return images
}

async function loadProductProperties(
  productId: bigint,
  partIds: bigint[]
): Promise<AdminCatalogProperty[]> {
  const [own, inherited] = await Promise.all([
    db.product_properties.findMany({
      where: { product_id: productId },
      orderBy: { key: 'asc' },
      take: PROPERTY_TAKE,
      select: { id: true, key: true, value: true, source: true }
    }),
    partIds.length
      ? db.part_properties.findMany({
          where: { part_id: { in: partIds } },
          orderBy: { key: 'asc' },
          take: PROPERTY_TAKE,
          select: { key: true, value: true }
        })
      : Promise.resolve([])
  ])

  const seen = new Set<string>()
  const properties: AdminCatalogProperty[] = []

  for (const row of own) {
    const key = row.key.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    properties.push({ id: row.id.toString(), key, value: row.value, source: row.source })
  }
  for (const row of inherited) {
    const key = row.key?.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    properties.push({ id: null, key, value: row.value, source: 'PARTS' })
  }

  return properties
}

/** Mutasyon dönüşü için ürünün güncel görsel listesi + birincil görsel. */
async function imageResult(
  productId: bigint,
  message: string
): Promise<MutateProductImageResult> {
  const [product, partIds] = await Promise.all([
    db.products.findUnique({
      where: { id: productId },
      select: { primary_image_url: true }
    }),
    getConfirmedPartIds(productId)
  ])
  const primaryImageUrl = product?.primary_image_url ?? null
  return {
    success: true,
    message,
    images: await loadProductImages(productId, primaryImageUrl, partIds),
    primaryImageUrl
  }
}

/** Mutasyon dönüşü için ürünün güncel özellik listesi. */
async function propertyResult(
  productId: bigint,
  message: string
): Promise<MutateProductPropertyResult> {
  const partIds = await getConfirmedPartIds(productId)
  return {
    success: true,
    message,
    properties: await loadProductProperties(productId, partIds)
  }
}

/**
 * Manuel görsel ekler. URL bu noktada zaten kalıcı bir adrestir — dosya
 * yükleme/harici indirme API route'unda (app/api/admin/catalog/products/[id]/
 * images) yapılır ve storage'a yazıldıktan sonra buraya düşer.
 *
 * Ürünün henüz birincil görseli yoksa ilk manuel görsel birincil yapılır;
 * vitrin kartları ve Meilisearch dokümanı products.primary_image_url okur.
 */
export async function addCatalogProductImage(input: {
  id: string
  url: string
  thumb?: string | null
}): Promise<MutateProductImageResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) {
    return { success: false, message: 'Ürün bulunamadı.', images: [], primaryImageUrl: null }
  }

  const url = input.url.trim()
  if (!url) {
    const current = await imageResult(product.productId, '')
    return { ...current, success: false, message: 'Geçerli bir görsel adresi gerekli.' }
  }

  await db.$transaction(async (tx) => {
    const [{ next_position: nextPosition }] = await tx.$queryRaw<
      Array<{ next_position: number }>
    >(Prisma.sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM catalog.product_images WHERE product_id = ${product.productId}
    `)

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_images (product_id, url, thumb, position, source)
      VALUES (${product.productId}, ${url}, ${input.thumb?.trim() || null}, ${nextPosition}, 'MANUAL')
      ON CONFLICT (product_id, url) DO NOTHING
    `)

    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.products SET primary_image_url = ${url}
      WHERE id = ${product.productId} AND primary_image_url IS NULL
    `)
  })

  revalidateCatalogAdmin(product.slug)
  return imageResult(product.productId, 'Görsel eklendi.')
}

/**
 * Manuel bir görseli siler. Devralınan (PARTS) görsellerin id'si olmadığı için
 * buraya hiç gelmez. Silinen görsel birincil ise birincil, kalan ilk manuel
 * görsele düşer (yoksa temizlenir).
 */
export async function removeCatalogProductImage(input: {
  id: string
  imageId: string
}): Promise<MutateProductImageResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) {
    return { success: false, message: 'Ürün bulunamadı.', images: [], primaryImageUrl: null }
  }

  let imageId: bigint
  try {
    imageId = BigInt(input.imageId)
  } catch {
    const current = await imageResult(product.productId, '')
    return { ...current, success: false, message: 'Geçersiz görsel kimliği.' }
  }

  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ url: string }>>(Prisma.sql`
      DELETE FROM catalog.product_images
      WHERE id = ${imageId} AND product_id = ${product.productId} AND source = 'MANUAL'
      RETURNING url
    `)
    if (!rows.length) return

    await tx.$executeRaw(Prisma.sql`
      UPDATE catalog.products p
      SET primary_image_url = (
        SELECT i.url FROM catalog.product_images i
        WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1
      )
      WHERE p.id = ${product.productId} AND p.primary_image_url = ${rows[0].url}
    `)
  })

  revalidateCatalogAdmin(product.slug)
  return imageResult(product.productId, 'Görsel kaldırıldı.')
}

/** Birincil görseli seçer (devralınan görseller de seçilebilir). */
export async function setCatalogProductPrimaryImage(input: {
  id: string
  url: string
}): Promise<MutateProductImageResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) {
    return { success: false, message: 'Ürün bulunamadı.', images: [], primaryImageUrl: null }
  }

  const url = input.url.trim()
  if (!url) {
    const current = await imageResult(product.productId, '')
    return { ...current, success: false, message: 'Geçerli bir görsel adresi gerekli.' }
  }

  await db.products.update({
    where: { id: product.productId },
    data: { primary_image_url: url }
  })

  revalidateCatalogAdmin(product.slug)
  return imageResult(product.productId, 'Birincil görsel güncellendi.')
}

/**
 * Manuel teknik özellik ekler/günceller (ör. «Genişlik (mm)» → «120»).
 * Anahtar ürün başına tekildir; aynı anahtar tekrar girilirse değeri güncellenir
 * ve devralınan TecDoc değerinin önüne geçer.
 */
export async function upsertCatalogProductProperty(
  input: MutateProductPropertyInput
): Promise<MutateProductPropertyResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', properties: [] }

  const key = input.key.trim()
  const value = input.value?.trim() ?? ''
  if (!key || !value) {
    const current = await propertyResult(product.productId, '')
    return { ...current, success: false, message: 'Özellik adı ve değeri zorunludur.' }
  }

  await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_properties (product_id, key, value, source)
    VALUES (${product.productId}, ${key}, ${value}, 'MANUAL')
    ON CONFLICT (product_id, key)
    DO UPDATE SET value = EXCLUDED.value, source = 'MANUAL'
  `)

  revalidateCatalogAdmin(product.slug)
  return propertyResult(product.productId, 'Özellik kaydedildi.')
}

/** Manuel bir özelliği siler; devralınan TecDoc değeri varsa yeniden görünür. */
export async function removeCatalogProductProperty(
  input: MutateProductPropertyInput
): Promise<MutateProductPropertyResult> {
  await requireAdminAuth()

  const product = await findProductForCode(input.id)
  if (!product) return { success: false, message: 'Ürün bulunamadı.', properties: [] }

  await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.product_properties
    WHERE product_id = ${product.productId} AND key = ${input.key.trim()} AND source = 'MANUAL'
  `)

  revalidateCatalogAdmin(product.slug)
  return propertyResult(product.productId, 'Özellik kaldırıldı.')
}

// ---------------------------------------------------------------------------
// Zenginleştirme kapsaması ve product_part_links onay kuyruğu
// ---------------------------------------------------------------------------

/** Katalog zenginleştirme kapsama özeti (önbellekli, ~5dk). */
export async function getEnrichmentCoverage(): Promise<CatalogEnrichmentCoverage> {
  await requireAdminAuth()
  return getCatalogEnrichmentCoverage()
}

export interface CandidateLinkRow {
  linkId: string
  productId: string
  partNo: string
  productName: string
  brandName: string
  matchMethod: string
  matchedCode: string | null
  confidence: number | null
  partName: string
  partBrandName: string
  oemCount: number
}

/** Onay bekleyen (CANDIDATE) link'leri listeler. */
export async function getCandidateProductPartLinks(input?: {
  brand?: string | null
  limit?: number
}): Promise<CandidateLinkRow[]> {
  await requireAdminAuth()

  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200)
  const brand = input?.brand?.trim() || null

  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    select l.id as link_id, l.product_id, l.match_method, l.matched_code, l.confidence,
           p.part_no, p.name as product_name, cb.brand as brand_name,
           pt.name as part_name, pb.name as part_brand_name,
           (select count(*) from part_oens o where o.part_id = l.part_id) as oem_count
    from catalog.product_part_links l
    join catalog.products p on p.id = l.product_id
    join catalog.brands cb on cb.id = p.brand_id
    join parts pt on pt.id = l.part_id
    left join part_brands pb on pb.id = pt.brand_id
    where l.status = 'CANDIDATE'
      and (${brand}::text is null or cb.brand = ${brand}::text)
    order by l.id
    limit ${limit}
  `

  return rows.map((r) => ({
    linkId: String(r.link_id),
    productId: String(r.product_id),
    partNo: String(r.part_no ?? ''),
    productName: String(r.product_name ?? ''),
    brandName: String(r.brand_name ?? ''),
    matchMethod: String(r.match_method ?? ''),
    matchedCode: r.matched_code ? String(r.matched_code) : null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    partName: String(r.part_name ?? ''),
    partBrandName: String(r.part_brand_name ?? ''),
    oemCount: Number(r.oem_count ?? 0)
  }))
}

export interface ReviewLinkResult {
  success: boolean
  message: string
}

/**
 * Bir CANDIDATE link'i onaylar ya da reddeder.
 *
 * Onaylandığında OEM'ler otomatik AKMAZ — türetme toplu iş olarak yapılır
 * (`bun scripts/derive-oems-from-part-links.ts`). Resim/özellik/araç uyumluluğu
 * ise read-through olduğu için onay anında görünür hale gelir.
 */
export async function reviewProductPartLink(input: {
  linkId: string
  decision: 'APPROVE' | 'REJECT'
}): Promise<ReviewLinkResult> {
  const session = await requireAdminAuth()

  let linkId: bigint
  try {
    linkId = BigInt(input.linkId)
  } catch {
    return { success: false, message: 'Geçersiz link id.' }
  }

  const nextStatus = input.decision === 'APPROVE' ? 'CONFIRMED' : 'REJECTED'
  const reviewer = session?.user?.email ?? 'admin'

  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.product_part_links
    SET status = ${nextStatus}, reviewed_at = now(), reviewed_by = ${reviewer}
    WHERE id = ${linkId} AND status = 'CANDIDATE'
  `)

  if (Number(updated) === 0) {
    return { success: false, message: 'Link bulunamadı ya da zaten incelenmiş.' }
  }

  revalidateCatalogAdmin()
  return {
    success: true,
    message: input.decision === 'APPROVE' ? 'Eşleşme onaylandı.' : 'Eşleşme reddedildi.'
  }
}

// ---------------------------------------------------------------------------
// Web kaynaklı OEM / ad önerileri (catalog.product_ref_suggestions)
//
// Kaynak açık web olduğu için öneriler doğrudan katalogda yayınlanmaz: burada
// kaynak URL + kanıt metniyle bekler, admin onayladığı anda product_oems
// (source='WEB') ve product_overrides.name_override'a yazılır. Onay = uygulama;
// ayrı bir toplu iş beklemeye gerek yok.
// ---------------------------------------------------------------------------

export interface RefSuggestionRow {
  id: string
  productId: string
  kind: 'OEM' | 'NAME'
  value: string
  oemBrand: string | null
  confidence: string
  sourceSite: string
  sourceUrl: string | null
  evidence: string | null
  status: string
  brandName: string
  partNo: string
  currentName: string
}

export interface RefSuggestionSummary {
  pendingOem: number
  pendingName: number
  appliedOem: number
  appliedName: number
  rejected: number
}

/** Öneri kuyruğunun özeti (rozet sayıları). */
export async function getRefSuggestionSummary(brand?: string | null): Promise<RefSuggestionSummary> {
  await requireAdminAuth()
  const brandFilter = brand?.trim() || null

  const rows = await db.$queryRaw<{ kind: string; status: string; n: bigint }[]>`
    select s.kind, s.status, count(*) n
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    where (${brandFilter}::text is null or b.brand = ${brandFilter}::text)
    group by s.kind, s.status
  `

  const pick = (kind: string, status: string) =>
    Number(rows.find((r) => r.kind === kind && r.status === status)?.n ?? 0)

  return {
    pendingOem: pick('OEM', 'PENDING'),
    pendingName: pick('NAME', 'PENDING'),
    appliedOem: pick('OEM', 'APPLIED'),
    appliedName: pick('NAME', 'APPLIED'),
    rejected: rows
      .filter((r) => r.status === 'REJECTED')
      .reduce((n, r) => n + Number(r.n), 0)
  }
}

/** İncelenecek önerileri listeler (varsayılan: bekleyenler). */
export async function getRefSuggestions(input?: {
  brand?: string | null
  kind?: 'OEM' | 'NAME' | null
  confidence?: string | null
  status?: string | null
  limit?: number
}): Promise<RefSuggestionRow[]> {
  await requireAdminAuth()

  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500)
  const brand = input?.brand?.trim() || null
  const kind = input?.kind ?? null
  const status = input?.status?.trim() || 'PENDING'
  const confidence = input?.confidence?.trim() || null

  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    select s.id, s.product_id, s.kind, s.value, s.oem_brand, s.confidence,
           s.source_site, s.source_url, s.evidence, s.status,
           b.brand as brand_name, p.part_no,
           ${canonicalNameSql('p', 'o')} as current_name
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    ${canonicalOverrideJoin('p', 'o')}
    where s.status = ${status}
      and (${brand}::text is null or b.brand = ${brand}::text)
      and (${kind}::text is null or s.kind = ${kind}::text)
      and (${confidence}::text is null or s.confidence = ${confidence}::text)
    order by p.part_no, s.kind, s.id
    limit ${limit}
  `

  return rows.map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    kind: String(r.kind) as 'OEM' | 'NAME',
    value: String(r.value ?? ''),
    oemBrand: r.oem_brand ? String(r.oem_brand) : null,
    confidence: String(r.confidence ?? 'MEDIUM'),
    sourceSite: String(r.source_site ?? ''),
    sourceUrl: r.source_url ? String(r.source_url) : null,
    evidence: r.evidence ? String(r.evidence) : null,
    status: String(r.status ?? ''),
    brandName: String(r.brand_name ?? ''),
    partNo: String(r.part_no ?? ''),
    currentName: String(r.current_name ?? '')
  }))
}

export interface ReviewRefSuggestionResult {
  success: boolean
  message: string
  appliedIds: string[]
}

/**
 * Önerileri onaylar (uygular) ya da reddeder.
 *
 * Onay yolunda OEM satırı catalog.product_oems'e source='WEB' ile yazılır —
 * MANUAL'den ayrı tutulur ki toplu geri alma (`delete … where source='WEB'`)
 * elle girilen kayıtlara dokunmasın. Ad önerisi product_overrides.name_override
 * alanına yazılır; aynı satırdaki fiyat/kilit/not alanları KORUNUR (upsert
 * yerine hedefli update — updateCatalogProductOverride'ın tam satır davranışı
 * burada veri kaybettirirdi).
 */
export async function reviewRefSuggestions(input: {
  ids: string[]
  decision: 'APPROVE' | 'REJECT'
}): Promise<ReviewRefSuggestionResult> {
  const auth = await requireAdminAuth()
  const reviewer = auth.user.email ?? auth.user.id

  const ids: bigint[] = []
  // Tek çağrıda sınır: onay yolu ürün başına arama dokümanı da tazeliyor,
  // sınırsız toplu onay server action'ı zaman aşımına düşürürdü.
  for (const raw of input.ids.slice(0, MAX_REVIEW_BATCH)) {
    try {
      ids.push(BigInt(raw))
    } catch {
      /* geçersiz id sessizce atlanır */
    }
  }
  if (ids.length === 0) {
    return { success: false, message: 'Geçerli öneri seçilmedi.', appliedIds: [] }
  }

  if (input.decision === 'REJECT') {
    const n = await db.$executeRaw(Prisma.sql`
      update catalog.product_ref_suggestions
      set status = 'REJECTED', reviewed_at = now(), reviewed_by = ${reviewer}
      where id in (${Prisma.join(ids)}) and status = 'PENDING'
    `)
    revalidateCatalogAdmin()
    return {
      success: true,
      message: `${Number(n)} öneri reddedildi.`,
      appliedIds: input.ids
    }
  }

  const applied = await applyPendingSuggestions(ids, reviewer)
  if (applied.total === 0) {
    return { success: false, message: 'Öneri bulunamadı ya da zaten incelenmiş.', appliedIds: [] }
  }

  return {
    success: true,
    message: `${applied.oemCount} OEM · ${applied.nameCount} ad önerisi uygulandı.`,
    appliedIds: applied.appliedIds
  }
}

interface ApplyOutcome {
  total: number
  oemCount: number
  nameCount: number
  appliedIds: string[]
}

/**
 * PENDING önerileri kanonik tablolara yazar ve APPLIED işaretler.
 *
 * OEM satırı source='WEB' ile eklenir — MANUAL'den ayrı durması toplu geri
 * almayı (`delete … where source='WEB'`) elle girilen kayıtlara dokunmadan
 * mümkün kılar. Ad önerisi product_overrides.name_override'a hedefli update ile
 * yazılır; aynı satırdaki fiyat/kilit/not alanları KORUNUR
 * (updateCatalogProductOverride'ın tam satır davranışı burada veri kaybettirirdi).
 */
async function applyPendingSuggestions(ids: bigint[], reviewer: string): Promise<ApplyOutcome> {
  if (ids.length === 0) return { total: 0, oemCount: 0, nameCount: 0, appliedIds: [] }

  const rows = await db.$queryRaw<
    {
      id: bigint
      product_id: bigint
      kind: string
      value: string
      value_norm: string
      oem_brand: string
      slug: string | null
    }[]
  >(Prisma.sql`
    select s.id, s.product_id, s.kind, s.value, s.value_norm, s.oem_brand, p.slug
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    where s.id in (${Prisma.join(ids)}) and s.status = 'PENDING'
  `)
  if (rows.length === 0) return { total: 0, oemCount: 0, nameCount: 0, appliedIds: [] }

  const oemRows = rows.filter((r) => r.kind === 'OEM')
  const nameRows = rows.filter((r) => r.kind === 'NAME')

  await db.$transaction(async (tx) => {
    // Tek INSERT'e sığmayacak kadar çok satır olabilir (kayış çapraz eşleşmesi
    // ürün başına onlarca OEM getiriyor) — parametre sınırına takılmamak için parçala.
    for (let i = 0; i < oemRows.length; i += 500) {
      const values = oemRows
        .slice(i, i + 500)
        .map(
          (r) => Prisma.sql`(${r.product_id}, ${r.value}, ${r.value_norm}, ${r.oem_brand}, ${'WEB'})`
        )
      await tx.$executeRaw(Prisma.sql`
        insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source)
        values ${Prisma.join(values)}
        on conflict (product_id, code_norm, oem_brand) do nothing
      `)
    }

    for (const r of nameRows) {
      await tx.$executeRaw(Prisma.sql`
        insert into catalog.product_overrides (product_id, name_override, updated_by)
        values (${r.product_id}, ${r.value}, ${reviewer})
        on conflict (product_id) do update
          set name_override = excluded.name_override,
              updated_by = excluded.updated_by,
              updated_at = current_timestamp
      `)
      // Aynı ürüne ait diğer bekleyen ad önerileri anlamsızlaşır.
      await tx.$executeRaw(Prisma.sql`
        update catalog.product_ref_suggestions
        set status = 'REJECTED', reviewed_at = now(), reviewed_by = ${reviewer}
        where product_id = ${r.product_id} and kind = 'NAME' and status = 'PENDING'
          and id <> ${r.id}
      `)
    }

    for (let i = 0; i < rows.length; i += 500) {
      await tx.$executeRaw(Prisma.sql`
        update catalog.product_ref_suggestions
        set status = 'APPLIED', reviewed_at = now(), reviewed_by = ${reviewer},
            applied_at = now()
        where id in (${Prisma.join(rows.slice(i, i + 500).map((r) => r.id))})
      `)
    }
  })

  // Arama dokümanı hem adı hem OEM havuzunu taşıyor → dokunulan ürünleri tazele.
  // Meili çağrıları sıralı yapılırsa toplu onay dakikalar sürer; 8'li gruplar hem
  // hızlı hem de Meili'yi boğmayacak kadar ölçülü.
  const touched = [...new Set(rows.map((r) => r.product_id.toString()))]
  for (let i = 0; i < touched.length; i += 8) {
    await Promise.all(touched.slice(i, i + 8).map((id) => syncProductSearchDocument(BigInt(id))))
  }
  for (const slug of new Set(rows.map((r) => r.slug))) {
    revalidateCatalogAdmin(slug)
  }

  return {
    total: rows.length,
    oemCount: oemRows.length,
    nameCount: nameRows.length,
    appliedIds: rows.map((r) => r.id.toString())
  }
}

export interface BulkReviewFilter {
  brand?: string | null
  kind?: 'OEM' | 'NAME' | null
  confidence?: string | null
}

export interface BulkReviewResult {
  success: boolean
  message: string
  /** Bu çağrıda işlenen öneri sayısı. */
  processed: number
  /** Filtreye uyan, hâlâ bekleyen öneri sayısı — UI bitene kadar tekrar çağırır. */
  remaining: number
}

/**
 * Filtreye uyan TÜM bekleyen önerileri onaylar ya da reddeder — parça parça.
 *
 * Neden parça parça: kayış çapraz eşleşmesi tek markada binlerce öneri
 * üretebiliyor; hepsini tek istekte uygulamak (ürün başına Meili tazeleme dahil)
 * server action'ı zaman aşımına düşürürdü. Çağrı başına MAX_BULK_BATCH kadarını
 * işler ve kalanı döndürür; arayüz kalan sıfırlanana dek yineler.
 */
export async function reviewAllPendingRefSuggestions(input: {
  filter: BulkReviewFilter
  decision: 'APPROVE' | 'REJECT'
}): Promise<BulkReviewResult> {
  const auth = await requireAdminAuth()
  const reviewer = auth.user.email ?? auth.user.id

  const brand = input.filter.brand?.trim() || null
  const kind = input.filter.kind ?? null
  const confidence = input.filter.confidence?.trim() || null

  const matching = Prisma.sql`
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    where s.status = 'PENDING'
      and (${brand}::text is null or b.brand = ${brand}::text)
      and (${kind}::text is null or s.kind = ${kind}::text)
      and (${confidence}::text is null or s.confidence = ${confidence}::text)
  `

  const batch = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    select s.id ${matching} order by s.id limit ${MAX_BULK_BATCH}
  `)
  if (batch.length === 0) {
    return { success: true, message: 'İşlenecek öneri kalmadı.', processed: 0, remaining: 0 }
  }
  const ids = batch.map((r) => r.id)

  let processed = 0
  if (input.decision === 'REJECT') {
    processed = Number(
      await db.$executeRaw(Prisma.sql`
        update catalog.product_ref_suggestions
        set status = 'REJECTED', reviewed_at = now(), reviewed_by = ${reviewer}
        where id in (${Prisma.join(ids)}) and status = 'PENDING'
      `)
    )
  } else {
    processed = (await applyPendingSuggestions(ids, reviewer)).total
  }

  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    select count(*) n ${matching}
  `)
  const remaining = Number(n)

  return {
    success: true,
    message:
      input.decision === 'APPROVE'
        ? `${processed} öneri uygulandı${remaining > 0 ? `, ${remaining} kaldı` : ''}.`
        : `${processed} öneri reddedildi${remaining > 0 ? `, ${remaining} kaldı` : ''}.`,
    processed,
    remaining
  }
}
