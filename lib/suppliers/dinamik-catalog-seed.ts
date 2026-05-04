import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  getBrandList,
  getStockList,
  getPriceList,
  type DinamikStockItem
} from '@/lib/suppliers/dinamik-client'

const DINAMIK_PROVIDER_CODE = 'dinamik'
const BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeedProgress = {
  phase: 'init' | 'brands' | 'stock' | 'prices' | 'done' | 'error'
  brand?: string
  brandIndex?: number
  totalBrands?: number
  itemCount?: number
  elapsed?: number
  message: string
}

export type SeedOptions = {
  brand?: string
  limitBrands?: number
  resume?: boolean
  onProgress?: (p: SeedProgress) => void
}

export type SeedResult = {
  runId: number
  totalBrands: number
  totalProducts: number
  totalPriceUpdates: number
  completedBrands: string[]
  skippedBrands: string[]
  errors: string[]
  durationMs: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKey(value: string | null | undefined): string {
  return (value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function elapsed(start: number): string {
  const ms = Date.now() - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

async function ensureProvider() {
  return db.supplier_providers.upsert({
    where: { code: DINAMIK_PROVIDER_CODE },
    update: { name: 'Dinamik', status: 'ACTIVE' },
    create: {
      code: DINAMIK_PROVIDER_CODE,
      name: 'Dinamik',
      status: 'ACTIVE',
      priority: 10,
      base_url: 'https://dinamikapp-api.dinamik.online'
    }
  })
}

// ---------------------------------------------------------------------------
// Step 1: Brand aliases (batch SQL)
// ---------------------------------------------------------------------------

async function batchUpsertBrandAliases(
  providerId: number,
  brands: string[]
): Promise<number> {
  if (brands.length === 0) return 0

  let total = 0
  for (let i = 0; i < brands.length; i += BATCH_SIZE) {
    const batch = brands.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (b) =>
        Prisma.sql`(${providerId}, ${b}, ${b.toLocaleUpperCase('tr')}, 'PENDING', NOW(), NOW())`
    )
    const count = await db.$executeRaw`
      INSERT INTO supplier_brand_aliases
        (provider_id, supplier_brand, normalized_brand, mapping_status, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (provider_id, supplier_brand) DO UPDATE SET
        normalized_brand = EXCLUDED.normalized_brand,
        updated_at = NOW()
    `
    total += Number(count)
  }
  return total
}

// ---------------------------------------------------------------------------
// Step 2: Stock upsert (batch SQL)
// ---------------------------------------------------------------------------

async function batchUpsertStock(
  providerId: number,
  brand: string,
  items: DinamikStockItem[]
): Promise<number> {
  if (items.length === 0) return 0

  // Deduplicate by SKU — keep last occurrence
  const bysku = new Map<string, DinamikStockItem>()
  for (const item of items) {
    const sku = item.stokKodu?.trim()
    if (sku) bysku.set(sku, item)
  }
  const unique = Array.from(bysku.values())

  let total = 0
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const values = batch.map((item) => {
      const sku = item.stokKodu.trim()
      return Prisma.sql`(
        ${providerId},
        ${brand + '::' + sku},
        ${sku},
        ${item.marka || brand},
        ${item.stokAdi || null},
        ${normalizeKey(sku)},
        ${normalizeKey(item.stokAdi)},
        ${item.barkod1 || null},
        ${item.barkod2 || null},
        ${item.barkod3 || null},
        ${item.fiyat ?? null},
        ${item.stokAdedi ?? 0},
        'TRY',
        ${JSON.stringify(item.raw || {})}::jsonb,
        NOW(), NOW(), NOW()
      )`
    })

    const count = await db.$executeRaw`
      INSERT INTO supplier_products (
        provider_id, supplier_product_key, supplier_sku, supplier_brand,
        supplier_name, normalized_sku, normalized_name,
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
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Step 3: Price update (batch SQL)
// ---------------------------------------------------------------------------

async function batchUpdatePrices(
  providerId: number,
  items: DinamikStockItem[]
): Promise<number> {
  if (items.length === 0) return 0

  // Only items that have a price
  const bysku = new Map<string, DinamikStockItem>()
  for (const item of items) {
    const sku = item.stokKodu?.trim()
    if (sku && item.fiyat != null) bysku.set(sku, item)
  }
  const unique = Array.from(bysku.values())
  if (unique.length === 0) return 0

  let total = 0
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const values = batch.map((item) =>
      Prisma.sql`(${item.stokKodu.trim()}, ${item.fiyat!})`
    )

    const count = await db.$executeRaw`
      UPDATE supplier_products sp
      SET supplier_price = data.price::decimal(10,2),
          updated_at     = NOW()
      FROM (VALUES ${Prisma.join(values)}) AS data(sku, price)
      WHERE sp.provider_id = ${providerId}
        AND sp.supplier_sku = data.sku
    `
    total += Number(count)
  }

  return total
}

// ---------------------------------------------------------------------------
// Run tracking & resume
// ---------------------------------------------------------------------------

type RunMeta = {
  mode: string
  completedBrands: string[]
  requestedBrand: string | null
  limitBrands: number | null
  totalProducts?: number
  totalPriceUpdates?: number
  skippedBrands?: string[]
  durationMs?: number
}

async function findResumableRun(providerId: number) {
  return db.supplier_sync_runs.findFirst({
    where: {
      provider_id: providerId,
      status: 'RUNNING',
      endpoint: 'catalog-seed-v2'
    },
    orderBy: { started_at: 'desc' }
  })
}

async function createRun(providerId: number, options: SeedOptions) {
  return db.supplier_sync_runs.create({
    data: {
      provider_id: providerId,
      trigger_type: 'MANUAL',
      endpoint: 'catalog-seed-v2',
      status: 'RUNNING',
      started_at: new Date(),
      meta: {
        mode: 'CATALOG_SEED_V2',
        completedBrands: [],
        requestedBrand: options.brand || null,
        limitBrands: options.limitBrands || null
      } satisfies RunMeta
    }
  })
}

function getCompletedBrandsFromMeta(meta: unknown): Set<string> {
  if (!meta || typeof meta !== 'object') return new Set()
  const m = meta as Record<string, unknown>
  if (!Array.isArray(m.completedBrands)) return new Set()
  return new Set(m.completedBrands as string[])
}

async function markBrandComplete(
  runId: number,
  brand: string,
  completed: Set<string>,
  counters: { products: number; prices: number }
) {
  completed.add(brand)
  await db.supplier_sync_runs.update({
    where: { id: runId },
    data: {
      success_count: completed.size,
      meta: {
        mode: 'CATALOG_SEED_V2',
        completedBrands: Array.from(completed),
        lastCompletedBrand: brand,
        totalProducts: counters.products,
        totalPriceUpdates: counters.prices,
        lastUpdatedAt: new Date().toISOString()
      }
    }
  })
}

async function finalizeRun(
  runId: number,
  result: SeedResult,
  completedBrands: Set<string>
) {
  const hasErrors = result.errors.length > 0
  await db.supplier_sync_runs.update({
    where: { id: runId },
    data: {
      status: hasErrors ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      ended_at: new Date(),
      total_count: result.totalProducts,
      success_count: completedBrands.size,
      failed_count: result.errors.length,
      error_summary: hasErrors
        ? result.errors.slice(0, 20).join(' | ')
        : null,
      meta: {
        mode: 'CATALOG_SEED_V2',
        completedBrands: result.completedBrands,
        skippedBrands: result.skippedBrands,
        totalProducts: result.totalProducts,
        totalPriceUpdates: result.totalPriceUpdates,
        durationMs: result.durationMs
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDinamikCatalogSeed(
  options: SeedOptions
): Promise<SeedResult> {
  const startTime = Date.now()
  const emit = options.onProgress ?? (() => {})

  // 1. Ensure provider exists
  emit({ phase: 'init', message: 'Provider kontrol ediliyor...' })
  const provider = await ensureProvider()

  // 2. Fetch brand list from API → upsert supplier_brand_aliases
  emit({ phase: 'brands', message: 'Marka listesi API den cekiliyor...' })
  const apiBrands = (await getBrandList())
    .map((b) => b.brand.trim())
    .filter(Boolean)
  const uniqueBrands = [...new Set(apiBrands)]

  const aliasCount = await batchUpsertBrandAliases(provider.id, uniqueBrands)
  emit({
    phase: 'brands',
    itemCount: uniqueBrands.length,
    message: `${uniqueBrands.length} marka kaydedildi (${aliasCount} row affected, ${elapsed(startTime)})`
  })

  // 3. Determine target brands
  let targetBrands = uniqueBrands.sort((a, b) => a.localeCompare(b, 'tr'))
  if (options.brand) {
    const requested = options.brand.trim().toLocaleUpperCase('tr')
    targetBrands = uniqueBrands.filter(
      (b) => b.toLocaleUpperCase('tr') === requested
    )
    if (targetBrands.length === 0) {
      throw new Error(`Marka bulunamadi: ${options.brand}`)
    }
  }
  if (options.limitBrands && options.limitBrands > 0) {
    targetBrands = targetBrands.slice(0, options.limitBrands)
  }

  // 4. Get or create run (resume support)
  let run: { id: number; meta: unknown }
  if (options.resume) {
    const existing = await findResumableRun(provider.id)
    if (existing) {
      run = existing
      emit({
        phase: 'init',
        message: `Onceki run #${existing.id} devam ettiriliyor (${getCompletedBrandsFromMeta(existing.meta).size} marka tamamlanmis)`
      })
    } else {
      run = await createRun(provider.id, options)
      emit({
        phase: 'init',
        message: `Devam edilecek run bulunamadi, yeni run #${run.id} olusturuldu`
      })
    }
  } else {
    run = await createRun(provider.id, options)
    emit({ phase: 'init', message: `Run #${run.id} olusturuldu` })
  }

  const completedBrands = getCompletedBrandsFromMeta(run.meta)
  const skippedBrands: string[] = []
  const errors: string[] = []
  let totalProducts = 0
  let totalPriceUpdates = 0

  // 5. Process each brand sequentially
  for (let i = 0; i < targetBrands.length; i++) {
    const brand = targetBrands[i]
    const brandLabel = `[${i + 1}/${targetBrands.length}] ${brand}`
    const brandStart = Date.now()

    // Skip already-completed brands (resume)
    if (completedBrands.has(brand)) {
      skippedBrands.push(brand)
      emit({
        phase: 'stock',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        message: `${brandLabel} -- ATLANDI (zaten tamamlanmis)`
      })
      continue
    }

    try {
      // 5a. getStockList → batch upsert supplier_products
      emit({
        phase: 'stock',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        message: `${brandLabel} stok cekiliyor...`
      })

      const stockItems = await getStockList(brand)
      const stockCount = await batchUpsertStock(provider.id, brand, stockItems)
      totalProducts += stockCount

      emit({
        phase: 'stock',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        itemCount: stockItems.length,
        message: `${brandLabel} stok: ${stockItems.length} urun yazildi (${elapsed(brandStart)})`
      })

      // 5b. getPriceList → batch update prices
      const priceStart = Date.now()
      emit({
        phase: 'prices',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        message: `${brandLabel} fiyat cekiliyor...`
      })

      const priceItems = await getPriceList(brand)
      const priceCount = await batchUpdatePrices(provider.id, priceItems)
      totalPriceUpdates += priceCount

      emit({
        phase: 'prices',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        itemCount: priceItems.length,
        message: `${brandLabel} fiyat: ${priceItems.length} guncellendi (${elapsed(priceStart)})`
      })

      // 5c. Mark brand complete in run meta
      await markBrandComplete(run.id, brand, completedBrands, {
        products: totalProducts,
        prices: totalPriceUpdates
      })

      emit({
        phase: 'stock',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        elapsed: Date.now() - brandStart,
        message: `${brandLabel} TAMAMLANDI (${elapsed(brandStart)}, toplam: ${elapsed(startTime)})`
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`[${brand}] ${msg}`)
      emit({
        phase: 'error',
        brand,
        brandIndex: i + 1,
        totalBrands: targetBrands.length,
        message: `${brandLabel} HATA: ${msg}`
      })
      // Continue to next brand
    }
  }

  // 6. Finalize
  const durationMs = Date.now() - startTime
  const result: SeedResult = {
    runId: run.id,
    totalBrands: targetBrands.length,
    totalProducts,
    totalPriceUpdates,
    completedBrands: Array.from(completedBrands),
    skippedBrands,
    errors,
    durationMs
  }

  await finalizeRun(run.id, result, completedBrands)

  await db.supplier_providers.update({
    where: { id: provider.id },
    data: { last_sync_at: new Date() }
  })

  emit({
    phase: 'done',
    elapsed: durationMs,
    message: `TAMAMLANDI: ${completedBrands.size} marka, ${totalProducts} urun, ${totalPriceUpdates} fiyat (${elapsed(startTime)})`
  })

  return result
}
