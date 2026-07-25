'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import { refreshSingleProductRollup } from '@/lib/catalog/refresh-product-rollups'
import { getPartEnrichment } from '@/lib/catalog/part-enrichment'
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
import type {
  AdminCatalogActionResult,
  AdminCatalogFilters,
  AdminCatalogListResult,
  AdminCatalogProductDetail,
  CatalogProductStatus,
  MutateProductCodeInput,
  MutateProductEanResult,
  MutateProductOemResult,
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

  // Zengin veri katalogda tutulmaz; onaylanmış product_part_links üzerinden
  // public.part_* tablolarından okunur.
  const enrichment = await getPartEnrichment(product.id)

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
    imageCount: enrichment.images.length,
    propertyCount: enrichment.properties.length,
    vehicleCount: enrichment.vehicleCount,
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
 * + eşleştirme için code_norm) saklanır. code_norm, enrich-from-parts'ın
 * part_oens.code ile kurduğu join'i besler.
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

  await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.product_oems
    WHERE product_id = ${product.productId} AND code_norm = ${codeNorm} AND source = 'MANUAL'
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
