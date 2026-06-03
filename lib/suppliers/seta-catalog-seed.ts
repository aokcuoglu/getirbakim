import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSetaProducts, type SetaProductItem } from '@/lib/suppliers/seta-client'
import { uploadImageFromUrl } from '@/lib/supabase/storage'

const SETA_PROVIDER_CODE = 'seta'
const SETA_BRAND_NAME = 'SETA'
const BATCH_SIZE = 200
// ID offset for SETA parts — well above existing max IDs
const SETA_PART_ID_OFFSET = BigInt('5000000000')
const SETA_ARTICLE_LINK_OFFSET = BigInt('5000000000')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeedProgress = {
  phase: string
  message: string
  count?: number
  total?: number
  elapsed?: number
}

export type SeedOptions = {
  onProgress?: (p: SeedProgress) => void
}

export type SeedResult = {
  runId: number
  totalProducts: number
  partsCreated: number
  oemsWritten: number
  crossRefsWritten: number
  imagesUploaded: number
  pricingWritten: number
  errors: string[]
  durationMs: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKey(value: string | null | undefined): string {
  return (value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function normalizeOemCode(value: string): string | null {
  const cleaned = value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
  return cleaned.length >= 2 ? cleaned : null
}

function elapsed(start: number): string {
  const ms = Date.now() - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Generate a deterministic part ID from a SETA SKU index */
function setaPartId(index: number): bigint {
  return SETA_PART_ID_OFFSET + BigInt(index)
}

function setaArticleLinkId(index: number): bigint {
  return SETA_ARTICLE_LINK_OFFSET + BigInt(index)
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string[]> = {
  'Hava Filtreleri': ['Hava Filtresi'],
  'Kamyon Hava Filtreleri': ['Hava Filtresi'],
  'Yağ Filtreleri': ['Yağ Filtresi'],
  'Kamyon Yağ Filtreleri': ['Yağ Filtresi'],
  'Yakıt Filtreleri': ['Yakıt Filtresi'],
  'Kamyon Yakıt Filtreleri': ['Yakıt Filtresi'],
  'Polen Filtreleri': ['Polen Filtresi'],
  'Kamyon Polen Filtreleri': ['Polen Filtresi'],
  'Şanzıman Filtresi': ['Şanzıman Filtresi', 'Filter'],
  'Elektrikli Araç Filtreleri': ['Filtre', 'Filter'],
  'Kurutucular': ['Filtre', 'Filter'],
  'Traktör Filtreleri': ['Filtre', 'Filter']
}

async function buildCategoryLookup(): Promise<Map<string, number>> {
  // Fetch candidate categories from DB
  const categories = await db.part_categories.findMany({
    where: {
      OR: [
        { name_tr: { contains: 'Filtre', mode: 'insensitive' } },
        { name: { contains: 'Filter', mode: 'insensitive' } },
        { name: { contains: 'Other', mode: 'insensitive' } }
      ]
    },
    select: { id: true, name: true, name_tr: true }
  })

  const lookup = new Map<string, number>()

  for (const [setaCat, candidates] of Object.entries(CATEGORY_MAP)) {
    for (const candidate of candidates) {
      const match = categories.find(
        (c) =>
          c.name_tr?.includes(candidate) ||
          c.name?.includes(candidate)
      )
      if (match) {
        lookup.set(setaCat, match.id)
        break
      }
    }
  }

  return lookup
}

async function ensureOthersCategory(): Promise<number> {
  const existing = await db.part_categories.findFirst({
    where: {
      OR: [
        { name: { equals: 'Others', mode: 'insensitive' } },
        { name_tr: { equals: 'Diğerleri', mode: 'insensitive' } }
      ]
    },
    select: { id: true }
  })

  if (existing) return existing.id

  // Get max ID and create new
  const maxRow = await db.$queryRaw<[{ max_id: number }]>(
    Prisma.sql`SELECT COALESCE(MAX(id), 0)::int AS max_id FROM part_categories`
  )
  const newId = (maxRow[0]?.max_id ?? 800000) + 1

  await db.part_categories.create({
    data: {
      id: newId,
      name: 'Others',
      name_tr: 'Diğerleri',
      is_active: true,
      has_childs: false,
      url_key: 'others'
    }
  })

  return newId
}

// ---------------------------------------------------------------------------
// Provider & Brand
// ---------------------------------------------------------------------------

async function ensureProvider() {
  return db.supplier_providers.upsert({
    where: { code: SETA_PROVIDER_CODE },
    update: { name: 'SETA', status: 'ACTIVE' },
    create: {
      code: SETA_PROVIDER_CODE,
      name: 'SETA',
      status: 'ACTIVE',
      priority: 20,
      base_url: 'https://b2b-api.ismyazilim.com'
    }
  })
}

async function ensureSetaBrand(): Promise<number> {
  const existing = await db.part_brands.findFirst({
    where: { name: { equals: SETA_BRAND_NAME, mode: 'insensitive' } },
    select: { id: true }
  })

  if (existing) return existing.id

  const maxRow = await db.$queryRaw<[{ max_id: number }]>(
    Prisma.sql`SELECT COALESCE(MAX(id), 0)::int AS max_id FROM part_brands`
  )
  const newId = (maxRow[0]?.max_id ?? 7000) + 1

  await db.part_brands.create({
    data: {
      id: newId,
      name: SETA_BRAND_NAME
    }
  })

  return newId
}

// ---------------------------------------------------------------------------
// Step 1: Upsert supplier_products (for supplier tracking)
// ---------------------------------------------------------------------------

async function batchUpsertSupplierProducts(
  providerId: number,
  items: SetaProductItem[]
): Promise<Map<string, number>> {
  if (items.length === 0) return new Map()

  const bysku = new Map<string, SetaProductItem>()
  for (const item of items) {
    const sku = item.sku.trim()
    if (sku) bysku.set(sku, item)
  }
  const unique = Array.from(bysku.values())

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const values = batch.map((item) => {
      const sku = item.sku.trim()
      return Prisma.sql`(
        ${providerId}, ${'seta::' + sku}, ${sku},
        ${item.brand || null}, ${item.name || null},
        ${normalizeKey(sku)}, ${normalizeKey(item.name)},
        ${item.barcode1 || null}, ${item.barcode2 || null}, ${item.barcode3 || null},
        ${item.price ?? null}, ${item.stockQty ?? 0}, ${item.currency || 'TRY'},
        ${JSON.stringify(item.raw || {})}::jsonb,
        NOW(), NOW(), NOW()
      )`
    })

    await db.$executeRaw`
      INSERT INTO supplier_products (
        provider_id, supplier_product_key, supplier_sku,
        supplier_brand, supplier_name, normalized_sku, normalized_name,
        barcode_1, barcode_2, barcode_3,
        supplier_price, supplier_stock_qty, currency, raw_json,
        last_seen_at, created_at, updated_at
      ) VALUES ${Prisma.join(values)}
      ON CONFLICT (provider_id, supplier_sku) DO UPDATE SET
        supplier_product_key = EXCLUDED.supplier_product_key,
        supplier_brand      = EXCLUDED.supplier_brand,
        supplier_name       = EXCLUDED.supplier_name,
        normalized_sku      = EXCLUDED.normalized_sku,
        normalized_name     = EXCLUDED.normalized_name,
        barcode_1           = EXCLUDED.barcode_1,
        barcode_2           = EXCLUDED.barcode_2,
        barcode_3           = EXCLUDED.barcode_3,
        supplier_price      = EXCLUDED.supplier_price,
        supplier_stock_qty  = EXCLUDED.supplier_stock_qty,
        raw_json            = EXCLUDED.raw_json,
        last_seen_at        = NOW(),
        updated_at          = NOW()
    `
  }

  // Fetch IDs back
  const skus = unique.map((item) => item.sku.trim())
  const rows = await db.supplier_products.findMany({
    where: { provider_id: providerId, supplier_sku: { in: skus } },
    select: { id: true, supplier_sku: true }
  })

  const skuToId = new Map<string, number>()
  for (const row of rows) {
    skuToId.set(row.supplier_sku, row.id)
  }
  return skuToId
}

// ---------------------------------------------------------------------------
// Step 2: Upsert supplier_product_oems
// ---------------------------------------------------------------------------

async function batchUpsertSupplierOems(
  providerId: number,
  items: SetaProductItem[],
  skuToProductId: Map<string, number>
): Promise<number> {
  type OemRow = {
    providerId: number
    supplierProductId: number
    oemCode: string
    normalizedCode: string
  }
  const uniqueOems = new Map<string, OemRow>()

  for (const item of items) {
    const productId = skuToProductId.get(item.sku.trim())
    if (!productId) continue

    for (const code of item.oemCodes) {
      const normalized = normalizeOemCode(code)
      if (!normalized) continue
      const key = `${providerId}::${productId}::${normalized}::API`
      if (!uniqueOems.has(key)) {
        uniqueOems.set(key, {
          providerId,
          supplierProductId: productId,
          oemCode: code.trim(),
          normalizedCode: normalized
        })
      }
    }
  }

  const allRows = Array.from(uniqueOems.values())
  if (allRows.length === 0) return 0

  let total = 0
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (r) =>
        Prisma.sql`(${r.providerId}, ${r.supplierProductId}, ${r.oemCode}, ${r.normalizedCode}, 'API', true, NOW(), NOW())`
    )

    const count = await db.$executeRaw`
      INSERT INTO supplier_product_oems
        (provider_id, supplier_product_id, oem_code, normalized_oem_code, source, is_active, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (provider_id, supplier_product_id, normalized_oem_code, source) DO UPDATE SET
        oem_code   = EXCLUDED.oem_code,
        is_active  = true,
        updated_at = NOW()
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 3: Create parts entries
// ---------------------------------------------------------------------------

type PartEntry = {
  id: bigint
  articleLinkId: bigint
  name: string
  brandId: number
  categoryId: number
  sku: string
  price: number | null
  stockQty: number
  currency: string
}

function buildPartEntries(
  items: SetaProductItem[],
  brandId: number,
  categoryLookup: Map<string, number>,
  fallbackCategoryId: number
): PartEntry[] {
  const entries: PartEntry[] = []
  const seenSkus = new Set<string>()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const sku = item.sku.trim()
    if (!sku || seenSkus.has(sku)) continue
    seenSkus.add(sku)

    const setaCategory = (item.raw.category as string)?.trim() || ''
    const categoryId = categoryLookup.get(setaCategory) ?? fallbackCategoryId

    entries.push({
      id: setaPartId(i + 1),
      articleLinkId: setaArticleLinkId(i + 1),
      name: item.name || sku,
      brandId,
      categoryId,
      sku,
      price: item.price,
      stockQty: item.stockQty,
      currency: item.currency || 'TRY'
    })
  }

  return entries
}

async function batchUpsertParts(entries: PartEntry[]): Promise<number> {
  if (entries.length === 0) return 0

  let total = 0
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (e) => Prisma.sql`(
        ${e.id}, ${e.articleLinkId}, ${e.name},
        ${e.brandId}, ${e.categoryId},
        NOW(), NOW()
      )`
    )

    const count = await db.$executeRaw`
      INSERT INTO parts (id, article_link_id, name, brand_id, category_id, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (id) DO UPDATE SET
        name       = EXCLUDED.name,
        brand_id   = EXCLUDED.brand_id,
        category_id = EXCLUDED.category_id,
        updated_at = NOW()
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 4: part_oens — OEM codes for the new parts
// ---------------------------------------------------------------------------

async function batchUpsertPartOens(
  items: SetaProductItem[],
  skuToPartId: Map<string, bigint>
): Promise<number> {
  type OenRow = { partId: bigint; brand: string; code: string }
  const unique = new Map<string, OenRow>()

  for (const item of items) {
    const partId = skuToPartId.get(item.sku.trim())
    if (!partId) continue

    // The "brand" in part_oens is the vehicle manufacturer brand
    const oemBrand = (item.raw.brand as string)?.trim() || 'OEM'

    for (const code of item.oemCodes) {
      const trimmed = code.trim()
      if (!trimmed) continue
      const key = `${partId}::${trimmed}`
      if (!unique.has(key)) {
        unique.set(key, { partId, brand: oemBrand, code: trimmed })
      }
    }
  }

  const rows = Array.from(unique.values())
  if (rows.length === 0) return 0

  let total = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (r) => Prisma.sql`(${r.brand}, ${r.code}, ${Number(r.partId)}::bigint)`
    )

    const count = await db.$executeRaw`
      INSERT INTO part_oens (brand, code, part_id)
      SELECT v.brand, v.code, v.part_id
      FROM (VALUES ${Prisma.join(values)}) AS v(brand, code, part_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM part_oens po
        WHERE po.part_id = v.part_id
          AND po.code = v.code
      )
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 5: part_cross_references — from cross object
// ---------------------------------------------------------------------------

async function batchUpsertCrossReferences(
  items: SetaProductItem[],
  skuToPartId: Map<string, bigint>
): Promise<number> {
  type CrossRow = { partId: bigint; brandName: string; articleNumber: string }
  const unique = new Map<string, CrossRow>()

  for (const item of items) {
    const partId = skuToPartId.get(item.sku.trim())
    if (!partId) continue

    const cross = item.raw.cross
    if (!cross || typeof cross !== 'object' || Array.isArray(cross)) continue

    for (const [brandName, articleValue] of Object.entries(
      cross as Record<string, unknown>
    )) {
      const article =
        typeof articleValue === 'string' ? articleValue.trim() : null
      if (!article || !brandName.trim()) continue
      const key = `${partId}::${brandName.trim().toUpperCase()}::${normalizeKey(article)}`
      if (!unique.has(key)) {
        unique.set(key, {
          partId,
          brandName: brandName.trim(),
          articleNumber: article
        })
      }
    }
  }

  const rows = Array.from(unique.values())
  if (rows.length === 0) return 0

  let total = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (r) =>
        Prisma.sql`(${r.brandName}, ${r.articleNumber}, ${Number(r.partId)}::bigint)`
    )

    const count = await db.$executeRaw`
      INSERT INTO part_cross_references (brand_name, article_number, part_id)
      SELECT v.brand_name, v.article_number, v.part_id
      FROM (VALUES ${Prisma.join(values)}) AS v(brand_name, article_number, part_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM part_cross_references pcr
        WHERE pcr.part_id = v.part_id
          AND pcr.brand_name = v.brand_name
          AND pcr.article_number = v.article_number
      )
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 6: part_pricing_inventory
// ---------------------------------------------------------------------------

async function batchUpsertPricing(
  entries: PartEntry[],
  providerId: number,
  supplierSkuToProductId: Map<string, number>,
  skuToPartId: Map<string, bigint>
): Promise<number> {
  // Only entries with a price
  const withPrice = entries.filter((e) => e.price != null)
  if (withPrice.length === 0) return 0

  let total = 0
  for (let i = 0; i < withPrice.length; i += BATCH_SIZE) {
    const batch = withPrice.slice(i, i + BATCH_SIZE)
    const values = batch.map((e) => {
      const supplierProductId = supplierSkuToProductId.get(e.sku) ?? null
      return Prisma.sql`(
        ${Number(e.id)}::bigint,
        ${e.price},
        ${e.price},
        ${e.price},
        ${e.stockQty},
        0, 3,
        ${e.currency},
        'OK',
        ${providerId},
        ${supplierProductId},
        NOW(), NOW(), NOW(), NOW()
      )`
    })

    const count = await db.$executeRaw`
      INSERT INTO part_pricing_inventory (
        part_id, supplier_price, computed_cost_ex_vat, computed_selling_price_ex_vat,
        supplier_stock_qty, reserved_stock_qty, min_stock_level,
        currency, sync_status, source_provider_id, source_supplier_product_id,
        last_synced_at, last_policy_at, created_at, updated_at
      ) VALUES ${Prisma.join(values)}
      ON CONFLICT (part_id) DO UPDATE SET
        supplier_price                = EXCLUDED.supplier_price,
        computed_cost_ex_vat          = EXCLUDED.computed_cost_ex_vat,
        computed_selling_price_ex_vat = EXCLUDED.computed_selling_price_ex_vat,
        supplier_stock_qty            = EXCLUDED.supplier_stock_qty,
        sync_status                   = 'OK',
        source_provider_id            = EXCLUDED.source_provider_id,
        source_supplier_product_id    = EXCLUDED.source_supplier_product_id,
        last_synced_at                = NOW(),
        last_policy_at                = NOW(),
        updated_at                    = NOW()
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 7: Images — download from SETA, upload to Supabase Storage
// ---------------------------------------------------------------------------

async function uploadImages(
  items: SetaProductItem[],
  skuToPartId: Map<string, bigint>,
  emit: (p: SeedProgress) => void,
  startTime: number
): Promise<{ uploaded: number; errors: string[] }> {
  let uploaded = 0
  const errors: string[] = []
  const itemsWithImage = items.filter(
    (item) =>
      skuToPartId.has(item.sku.trim()) &&
      typeof item.raw.image === 'string' &&
      (item.raw.image as string).startsWith('http')
  )

  if (itemsWithImage.length === 0) return { uploaded, errors }

  // Check which parts already have images
  const partIds = itemsWithImage.map((item) =>
    skuToPartId.get(item.sku.trim())!
  )
  const existingImages = await db.part_images.findMany({
    where: { part_id: { in: partIds } },
    select: { part_id: true }
  })
  const hasImage = new Set(existingImages.map((r) => r.part_id))

  const toUpload = itemsWithImage.filter(
    (item) => !hasImage.has(skuToPartId.get(item.sku.trim())!)
  )

  if (toUpload.length === 0) return { uploaded, errors }

  // Process images with limited concurrency
  const CONCURRENCY = 5
  let cursor = 0

  async function worker() {
    while (cursor < toUpload.length) {
      const index = cursor++
      const item = toUpload[index]
      const sku = item.sku.trim()
      const partId = skuToPartId.get(sku)!
      const imageUrl = item.raw.image as string

      try {
        // Determine file extension from URL
        const urlPath = new URL(imageUrl).pathname
        const lastSegment = urlPath.split('.').pop()?.toLowerCase() || ''
        const ext = /^(jpg|jpeg|png|webp|gif|svg|avif)$/.test(lastSegment)
          ? lastSegment
          : 'jpg'
        const storagePath = `seta/${sku.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`

        const result = await uploadImageFromUrl(imageUrl, storagePath)
        if (result.publicUrl) {
          await db.part_images.create({
            data: {
              part_id: partId,
              image: result.publicUrl,
              thumb: result.publicUrl
            }
          })
          uploaded++
        } else {
          errors.push(`[${sku}] Image upload failed: ${result.error || 'unknown'}`)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`[${sku}] ${msg}`)
      }

      // Progress every 50 images
      if ((index + 1) % 50 === 0 || index === toUpload.length - 1) {
        emit({
          phase: 'images',
          count: uploaded,
          total: toUpload.length,
          message: `Gorseller: ${index + 1}/${toUpload.length} islendi, ${uploaded} yuklendi (${elapsed(startTime)})`
        })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return { uploaded, errors }
}

// ---------------------------------------------------------------------------
// Step 8: Brand aliases & supplier_part_mappings
// ---------------------------------------------------------------------------

async function upsertBrandAliases(
  providerId: number,
  items: SetaProductItem[]
): Promise<void> {
  const brands = new Set<string>()
  for (const item of items) {
    if (item.brand?.trim()) brands.add(item.brand.trim())
  }
  // Also add SETA itself
  brands.add(SETA_BRAND_NAME)
  if (brands.size === 0) return

  const brandList = Array.from(brands)
  for (let i = 0; i < brandList.length; i += BATCH_SIZE) {
    const batch = brandList.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (b) =>
        Prisma.sql`(${providerId}, ${b}, ${b.toLocaleUpperCase('tr')}, 'PENDING', NOW(), NOW())`
    )
    await db.$executeRaw`
      INSERT INTO supplier_brand_aliases
        (provider_id, supplier_brand, brand, mapping_status, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (provider_id, supplier_brand) DO UPDATE SET
        brand = EXCLUDED.brand,
        updated_at = NOW()
    `
  }
}

async function batchUpsertMappings(
  providerId: number,
  items: SetaProductItem[],
  supplierSkuToProductId: Map<string, number>,
  skuToPartId: Map<string, bigint>
): Promise<number> {
  type MappingRow = {
    providerId: number
    supplierProductId: number
    sku: string
    partId: bigint
  }
  const rows: MappingRow[] = []

  for (const item of items) {
    const sku = item.sku.trim()
    const supplierProductId = supplierSkuToProductId.get(sku)
    const partId = skuToPartId.get(sku)
    if (!supplierProductId || !partId) continue
    rows.push({ providerId, supplierProductId, sku, partId })
  }

  if (rows.length === 0) return 0

  let total = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (m) =>
        Prisma.sql`(
          ${m.providerId}, ${m.supplierProductId}, ${m.sku},
          ${Number(m.partId)}::bigint,
          'APPROVED', 'MATCHED_SETA_SEED', 1.0000,
          'seta_catalog_seed', false, 'system:seta-seed', NOW(),
          NOW(), NOW()
        )`
    )

    const count = await db.$executeRaw`
      INSERT INTO supplier_part_mappings
        (provider_id, supplier_product_id, supplier_sku, part_id,
         status, workflow_status, confidence, match_reason,
         is_manual, approved_by, approved_at,
         created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (provider_id, supplier_product_id) DO UPDATE SET
        part_id         = EXCLUDED.part_id,
        status          = EXCLUDED.status,
        workflow_status = EXCLUDED.workflow_status,
        confidence      = EXCLUDED.confidence,
        match_reason    = EXCLUDED.match_reason,
        updated_at      = NOW()
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSetaCatalogSeed(
  options: SeedOptions = {}
): Promise<SeedResult> {
  const startTime = Date.now()
  const emit = options.onProgress ?? (() => {})
  const errors: string[] = []

  // 1. Ensure provider + brand
  emit({ phase: 'init', message: 'SETA provider ve marka kontrol ediliyor...' })
  const provider = await ensureProvider()
  const brandId = await ensureSetaBrand()

  // 2. Build category lookup + ensure Others category
  emit({ phase: 'init', message: 'Kategori eslestirmesi hazirlaniyor...' })
  const categoryLookup = await buildCategoryLookup()
  const othersCategoryId = await ensureOthersCategory()

  // 3. Create sync run
  const run = await db.supplier_sync_runs.create({
    data: {
      provider_id: provider.id,
      trigger_type: 'MANUAL',
      endpoint: 'seta-catalog-seed',
      status: 'RUNNING',
      started_at: new Date(),
      meta: { mode: 'SETA_CATALOG_SEED_V2' }
    }
  })
  emit({ phase: 'init', message: `Run #${run.id} olusturuldu` })

  try {
    // 4. Fetch all products from SETA API
    emit({ phase: 'fetch', message: 'SETA API den urunler cekiliyor...' })
    const items = await getSetaProducts('full')
    emit({
      phase: 'fetch',
      count: items.length,
      message: `${items.length} urun cekildi (${elapsed(startTime)})`
    })

    // 5. Upsert supplier_products (tracking table)
    emit({ phase: 'supplier', message: 'supplier_products yaziliyor...' })
    const supplierSkuToProductId = await batchUpsertSupplierProducts(
      provider.id,
      items
    )
    emit({
      phase: 'supplier',
      count: supplierSkuToProductId.size,
      message: `${supplierSkuToProductId.size} supplier product yazildi (${elapsed(startTime)})`
    })

    // 6. Upsert supplier_product_oems
    emit({ phase: 'supplier_oems', message: 'Supplier OEM kodlari yaziliyor...' })
    await batchUpsertSupplierOems(provider.id, items, supplierSkuToProductId)

    // 7. Brand aliases
    await upsertBrandAliases(provider.id, items)

    // 8. Build part entries and upsert into parts table
    emit({ phase: 'parts', message: 'parts tablosuna yaziliyor...' })
    const partEntries = buildPartEntries(
      items,
      brandId,
      categoryLookup,
      othersCategoryId
    )
    const partsCreated = await batchUpsertParts(partEntries)

    // Build sku → partId map
    const skuToPartId = new Map<string, bigint>()
    for (const entry of partEntries) {
      skuToPartId.set(entry.sku, entry.id)
    }

    emit({
      phase: 'parts',
      count: partsCreated,
      message: `${partsCreated} part yazildi (${elapsed(startTime)})`
    })

    // 9. part_oens
    emit({ phase: 'oems', message: 'part_oens yaziliyor...' })
    const oemsWritten = await batchUpsertPartOens(items, skuToPartId)
    emit({
      phase: 'oems',
      count: oemsWritten,
      message: `${oemsWritten} OEM kodu yazildi (${elapsed(startTime)})`
    })

    // 10. part_cross_references
    emit({ phase: 'cross', message: 'Capraz referanslar yaziliyor...' })
    const crossRefsWritten = await batchUpsertCrossReferences(items, skuToPartId)
    emit({
      phase: 'cross',
      count: crossRefsWritten,
      message: `${crossRefsWritten} capraz referans yazildi (${elapsed(startTime)})`
    })

    // 11. part_pricing_inventory
    emit({ phase: 'pricing', message: 'Fiyat ve stok yaziliyor...' })
    const pricingWritten = await batchUpsertPricing(
      partEntries,
      provider.id,
      supplierSkuToProductId,
      skuToPartId
    )
    emit({
      phase: 'pricing',
      count: pricingWritten,
      message: `${pricingWritten} fiyat yazildi (${elapsed(startTime)})`
    })

    // 12. supplier_part_mappings (link supplier_products → parts)
    emit({ phase: 'mappings', message: 'Mapping kayitlari yaziliyor...' })
    const mappingsWritten = await batchUpsertMappings(
      provider.id,
      items,
      supplierSkuToProductId,
      skuToPartId
    )
    emit({
      phase: 'mappings',
      count: mappingsWritten,
      message: `${mappingsWritten} mapping yazildi (${elapsed(startTime)})`
    })

    // 13. Images — download and upload to Supabase
    emit({
      phase: 'images',
      message: 'Gorseller indiriliyor ve Supabase a yukleniyor...'
    })
    const imageResult = await uploadImages(items, skuToPartId, emit, startTime)
    if (imageResult.errors.length > 0) {
      errors.push(...imageResult.errors.slice(0, 50))
    }
    emit({
      phase: 'images',
      count: imageResult.uploaded,
      message: `${imageResult.uploaded} gorsel yuklendi (${elapsed(startTime)})`
    })

    // 14. Finalize
    const durationMs = Date.now() - startTime
    const result: SeedResult = {
      runId: run.id,
      totalProducts: items.length,
      partsCreated,
      oemsWritten,
      crossRefsWritten,
      imagesUploaded: imageResult.uploaded,
      pricingWritten,
      errors,
      durationMs
    }

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        ended_at: new Date(),
        total_count: items.length,
        success_count: partsCreated,
        failed_count: errors.length,
        error_summary: errors.length > 0
          ? errors.slice(0, 20).join(' | ')
          : null,
        meta: {
          mode: 'SETA_CATALOG_SEED_V2',
          totalProducts: items.length,
          partsCreated,
          oemsWritten,
          crossRefsWritten,
          imagesUploaded: imageResult.uploaded,
          pricingWritten,
          mappingsWritten,
          durationMs
        }
      }
    })

    await db.supplier_providers.update({
      where: { id: provider.id },
      data: { last_sync_at: new Date() }
    })

    emit({
      phase: 'done',
      elapsed: durationMs,
      message: `TAMAMLANDI: ${partsCreated} part, ${oemsWritten} OEM, ${crossRefsWritten} cross-ref, ${imageResult.uploaded} gorsel, ${pricingWritten} fiyat (${elapsed(startTime)})`
    })

    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        ended_at: new Date(),
        error_summary: msg
      }
    })
    throw error
  }
}
