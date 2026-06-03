import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { deleteCachePattern } from '@/lib/redis'
import {
  DEFAULT_PRICING_POLICY,
  calculateSellingPrice,
  normalizeRate,
  resolvePricingPolicyFromProviderConfig
} from '@/lib/pricing/calculate-selling-price'
import {
  getBrandList,
  getPriceList,
  getStockBySku,
  getStockList,
  type DinamikStockItem,
  type SupplierApiError
} from '@/lib/suppliers/dinamik-client'
import { mergeDinamikItemsBySku } from '@/lib/suppliers/dinamik-stock'
import { ensureSupplierMappingCrossReference } from '@/lib/suppliers/cross-reference-mirror'
import { scheduleSearchIndexUpdate } from '@/lib/search/update-search-index'

const DINAMIK_PROVIDER_CODE = 'dinamik'
const AUTO_APPROVE_CONFIDENCE = 0.98
const DEFAULT_STALE_DAYS = 3
// Optimized concurrency for production workloads
const DEFAULT_BRAND_CONCURRENCY = parseInt(process.env.DINAMIK_BRAND_CONCURRENCY || '8', 10)
const DEFAULT_ITEM_CONCURRENCY = parseInt(process.env.DINAMIK_ITEM_CONCURRENCY || '50', 10)
const DEFAULT_POLICY_CONCURRENCY = parseInt(process.env.SUPPLIER_POLICY_CONCURRENCY || '24', 10)
const DEFAULT_BATCH_SIZE = parseInt(process.env.DINAMIK_BATCH_SIZE || '500', 10)

const DEFAULT_PROVIDER_CONFIG = {
  stockListPath: '/api/Dnmk_Customer/getStockList/{brand}',
  priceListPath: '/api/Dnmk_Customer/getPriceList/{brand}',
  stockPath: '/api/Dnmk_Customer/getStock',
  supportsRealtimeStock: true,
  pricing: {
    ...DEFAULT_PRICING_POLICY,
    rounding: 'HALF_UP_2',
    vatMode: 'EXCLUDED'
  }
}

type TriggerType = 'MANUAL' | 'SCHEDULED'
type SyncMode = 'full' | 'delta'

type CandidateInfo = {
  partId: bigint
  confidence: number
  reasons: string[]
}

type SyncBrandSummary = {
  brand: string
  fetched: number
  staged: number
  approved: number
  queued: number
  offers: number
}

export interface DinamikSyncOptions {
  triggerType?: TriggerType
  brands?: string[]
  limitBrands?: number
}

export interface DinamikSyncResult {
  runId: number
  providerId: number
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'
  totalCount: number
  successCount: number
  failedCount: number
  mappingMissCount: number
  brands: SyncBrandSummary[]
  errors: string[]
}

type CatalogSeedBrandSummary = {
  brand: string
  fetched: number
  seeded: number
  failed: number
}

export interface DinamikCatalogSeedOptions {
  triggerType?: TriggerType
  brand?: string
  limitBrands?: number
  mode?: SyncMode
}

export interface DinamikCatalogSeedResult {
  runId: number
  providerId: number
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'
  brandCount: number
  totalCount: number
  successCount: number
  failedCount: number
  errorCount: number
  mappingMissCount: number
  approvedMappingCount: number
  offerCount: number
  policyUpdatedCount: number
  brands: CatalogSeedBrandSummary[]
  errors: string[]
}

export function mergeDinamikStockAndPriceRows(
  stockRows: DinamikStockItem[],
  priceRows: DinamikStockItem[]
): DinamikStockItem[] {
  return mergeDinamikItemsBySku(stockRows, priceRows)
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length ? text : null
}

function parseConcurrency(
  value: string | undefined,
  fallback: number,
  maxValue = 32
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.min(maxValue, Math.trunc(parsed)))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) break
        results[index] = await worker(items[index], index)
      }
    })
  )

  return results
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function normalizeOemCode(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const normalized = text.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
  if (normalized.length < 2) return null
  return normalized
}

type SupplierOemRow = {
  id?: number
  code: string
  normalizedCode: string
  brand: string | null
}

function splitCodesFromText(text: string): string[] {
  return text
    .split(/[,\n;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractOemRowsFromUnknown(
  value: unknown,
  fallbackBrand: string | null
): SupplierOemRow[] {
  if (value == null) return []

  if (typeof value === 'string') {
    return splitCodesFromText(value)
      .map((code) => {
        const normalizedCode = normalizeOemCode(code)
        if (!normalizedCode) return null
        return {
          code,
          normalizedCode,
          brand: fallbackBrand
        } satisfies SupplierOemRow
      })
      .filter((row): row is SupplierOemRow => Boolean(row))
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractOemRowsFromUnknown(item, fallbackBrand))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const brand =
      normalizeText(record.brand) ||
      normalizeText(record.marka) ||
      normalizeText(record.oemBrand) ||
      normalizeText(record.oem_brand) ||
      fallbackBrand

    const directCodeValues = [
      record.code,
      record.oem,
      record.oemCode,
      record.oem_code,
      record.kod,
      record.no,
      record.number,
      record.value
    ]

    const rows = directCodeValues.flatMap((candidate) =>
      extractOemRowsFromUnknown(candidate, brand)
    )

    if (rows.length > 0) {
      return rows
    }

    return Object.values(record).flatMap((candidate) =>
      extractOemRowsFromUnknown(candidate, brand)
    )
  }

  return []
}

function collectOemRowsFromRaw(
  raw: Record<string, unknown>,
  fallbackBrand: string | null
): SupplierOemRow[] {
  const collected = [
    ...extractOemRowsFromUnknown(raw.oemListe, fallbackBrand),
    ...extractOemRowsFromUnknown(raw.oem, fallbackBrand),
    ...extractOemRowsFromUnknown(raw.oem_codes, fallbackBrand),
    ...extractOemRowsFromUnknown(raw.oemCodes, fallbackBrand),
    ...extractOemRowsFromUnknown(raw.oem_kodlari, fallbackBrand),
    ...extractOemRowsFromUnknown(raw.oemKodlari, fallbackBrand)
  ]

  const unique = new Map<string, SupplierOemRow>()
  for (const row of collected) {
    const key = `${row.normalizedCode}::${(row.brand || '').toLocaleUpperCase('tr')}`
    if (!unique.has(key)) {
      unique.set(key, row)
    }
  }

  return Array.from(unique.values()).slice(0, 120)
}

function toDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Prisma.Decimal(value)
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function classifyError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as SupplierApiError).status === 'number'
  ) {
    const status = (error as SupplierApiError).status
    if (status === 401 || status === 403) return 'auth'
    if (status === 429) return 'rate-limit'
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error)
  if (message.includes('json') || message.includes('parse')) return 'payload-parse'
  if (message.includes('mapping')) return 'mapping-miss'
  if (message.includes('constraint') || message.includes('database')) return 'db-write'

  return 'unknown'
}

async function ensureDinamikProvider() {
  return db.supplier_providers.upsert({
    where: { code: DINAMIK_PROVIDER_CODE },
    update: {
      name: 'Dinamik',
      status: 'ACTIVE',
      priority: 10,
      schedule: 'HOURLY',
      base_url: 'https://dinamikapp-api.dinamik.online'
    },
    create: {
      code: DINAMIK_PROVIDER_CODE,
      name: 'Dinamik',
      status: 'ACTIVE',
      priority: 10,
      schedule: 'HOURLY',
      base_url: 'https://dinamikapp-api.dinamik.online',
      config: DEFAULT_PROVIDER_CONFIG
    }
  })
}

async function ensureBrandAlias(providerId: number, supplierBrand: string | null) {
  if (!supplierBrand) {
    return null
  }

  const brandName = supplierBrand.trim()
  if (!brandName) return null

  const normalizedBrand = brandName.toLocaleUpperCase('tr')
  const existing = await db.supplier_brand_aliases.findFirst({
    where: {
      provider_id: providerId,
      supplier_brand: brandName
    }
  })

  let matchedPartBrandId = existing?.part_brand_id ?? null
  if (!matchedPartBrandId) {
    const partBrand = await db.part_brands.findFirst({
      where: {
        name: {
          equals: brandName,
          mode: 'insensitive'
        }
      },
      select: { id: true }
    })
    matchedPartBrandId = partBrand?.id ?? null
  }

  if (existing) {
    const updated = await db.supplier_brand_aliases.update({
      where: { id: existing.id },
      data: {
        brand: normalizedBrand,
        part_brand_id: matchedPartBrandId,
        mapping_status: matchedPartBrandId ? 'APPROVED' : existing.mapping_status,
        confidence: matchedPartBrandId ? new Prisma.Decimal(1) : existing.confidence
      }
    })

    return updated.part_brand_id
  }

  const created = await db.supplier_brand_aliases.create({
    data: {
      provider_id: providerId,
      supplier_brand: brandName,
      brand: normalizedBrand,
      part_brand_id: matchedPartBrandId,
      mapping_status: matchedPartBrandId ? 'APPROVED' : 'PENDING',
      confidence: matchedPartBrandId ? new Prisma.Decimal(1) : null
    }
  })

  return created.part_brand_id
}

async function syncSupplierProductApiOems(args: {
  providerId: number
  supplierProductId: number
  supplierBrand: string | null
  raw: Record<string, unknown>
}): Promise<SupplierOemRow[]> {
  const normalizedBrand = normalizeText(args.supplierBrand)
  const rows = collectOemRowsFromRaw(args.raw, normalizedBrand)

  for (const row of rows) {
    await db.supplier_product_oems.upsert({
      where: {
        provider_id_supplier_product_id_normalized_oem_code_source: {
          provider_id: args.providerId,
          supplier_product_id: args.supplierProductId,
          normalized_oem_code: row.normalizedCode,
          source: 'API'
        }
      },
      update: {
        oem_code: row.code,
        oem_brand: row.brand,
        is_active: true
      },
      create: {
        provider_id: args.providerId,
        supplier_product_id: args.supplierProductId,
        oem_code: row.code,
        normalized_oem_code: row.normalizedCode,
        oem_brand: row.brand,
        source: 'API',
        is_active: true
      }
    })
  }

  if (rows.length === 0) {
    await db.supplier_product_oems.updateMany({
      where: {
        provider_id: args.providerId,
        supplier_product_id: args.supplierProductId,
        source: 'API'
      },
      data: { is_active: false }
    })
    return []
  }

  await db.supplier_product_oems.updateMany({
    where: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId,
      source: 'API',
      normalized_oem_code: {
        notIn: rows.map((row) => row.normalizedCode)
      }
    },
    data: { is_active: false }
  })

  return rows
}

/**
 * Batch OEM sync - processes multiple products' OEMs in parallel
 * Uses individual upserts but with controlled concurrency
 */
async function batchSyncSupplierProductOems(
  providerId: number,
  productIdsWithRaw: Array<{
    supplierProductId: number
    supplierBrand: string | null
    raw: Record<string, unknown>
  }>
): Promise<void> {
  if (productIdsWithRaw.length === 0) return

  // Process each product's OEMs
  const batchSize = 50
  for (let i = 0; i < productIdsWithRaw.length; i += batchSize) {
    const batch = productIdsWithRaw.slice(i, i + batchSize)
    
    const promises = batch.map(async ({ supplierProductId, supplierBrand, raw }) => {
      await syncSupplierProductApiOems({
        providerId,
        supplierProductId,
        supplierBrand,
        raw
      })
    })
    
    await Promise.all(promises)
  }
}

async function getActiveSupplierOems(providerId: number, supplierProductId: number) {
  const rows = await db.supplier_product_oems.findMany({
    where: {
      provider_id: providerId,
      supplier_product_id: supplierProductId,
      is_active: true
    },
    select: {
      id: true,
      oem_code: true,
      normalized_oem_code: true,
      oem_brand: true
    },
    orderBy: { updated_at: 'desc' },
    take: 120
  })

  return rows.map((row) => ({
    id: row.id,
    code: row.oem_code,
    normalizedCode: row.normalized_oem_code,
    brand: row.oem_brand
  }))
}

async function deactivateStaleOffersForProvider(args: {
  providerId: number
  staleBefore: Date
}): Promise<bigint[]> {
  const rows = await db.$queryRaw<Array<{ part_id: string }>>(Prisma.sql`
    SELECT DISTINCT o.part_id::text AS part_id
    FROM part_supplier_offers o
    JOIN supplier_products sp ON sp.id = o.supplier_product_id
    WHERE o.provider_id = ${args.providerId}
      AND o.is_active = TRUE
      AND sp.last_seen_at < ${args.staleBefore}
  `)

  await db.$executeRaw(Prisma.sql`
    UPDATE part_supplier_offers o
    SET is_active = FALSE,
        updated_at = NOW(),
        last_synced_at = NOW()
    FROM supplier_products sp
    WHERE o.provider_id = ${args.providerId}
      AND o.supplier_product_id = sp.id
      AND o.is_active = TRUE
      AND sp.last_seen_at < ${args.staleBefore}
  `)

  // Zero out stock on stale supplier_products so admin counts reflect reality
  await db.$executeRaw(Prisma.sql`
    UPDATE supplier_products
    SET supplier_stock_qty = 0,
        updated_at = NOW()
    WHERE provider_id = ${args.providerId}
      AND supplier_stock_qty > 0
      AND last_seen_at < ${args.staleBefore}
  `)

  return rows
    .map((row) => {
      try {
        return BigInt(row.part_id)
      } catch {
        return null
      }
    })
    .filter((value): value is bigint => value != null)
}

async function fetchPartMeta(partIds: bigint[]) {
  if (partIds.length === 0) {
    return new Map<bigint, { name: string; articleLinkId: string; brandId: number | null }>()
  }

  const parts = await db.parts.findMany({
    where: {
      id: { in: partIds }
    },
    select: {
      id: true,
      name: true,
      article_link_id: true,
      brand_id: true
    }
  })

  return new Map(
    parts.map((part) => [
      part.id,
      {
        name: part.name,
        articleLinkId: part.article_link_id.toString(),
        brandId: part.brand_id
      }
    ])
  )
}

async function findBestCandidate(
  item: DinamikStockItem,
  partBrandId: number | null,
  oemRows: SupplierOemRow[] = []
): Promise<CandidateInfo | null> {
  // Simplified candidate finding for performance
  // Only match by SKU/article_link_id and brand
  const sku = item.stokKodu
  const skuNorm = normalizeKey(sku)
  
  if (!skuNorm || skuNorm.length < 3) {
    return null
  }

  // Try direct article_link_id match first (fastest)
  if (/^\d+$/.test(sku)) {
    const articleLinkId = BigInt(sku)
    const part = await db.parts.findFirst({
      where: { 
        article_link_id: articleLinkId,
        ...(partBrandId ? { brand_id: partBrandId } : {})
      },
      select: { id: true, brand_id: true }
    })
    
    if (part) {
      const confidence = partBrandId && part.brand_id === partBrandId ? 0.99 : 0.85
      return {
        partId: part.id,
        confidence,
        reasons: ['article_link_id_exact']
      }
    }
  }

  // Fallback: Try OEM match if provided
  if (oemRows.length > 0) {
    const oemCodes = oemRows.slice(0, 10).map(r => r.normalizedCode)
    if (oemCodes.length > 0) {
      const part = await db.part_oens.findFirst({
        where: {
          code: { in: oemCodes },
          ...(partBrandId && oemRows[0].brand ? { 
            brand: { equals: oemRows[0].brand, mode: 'insensitive' } 
          } : {})
        },
        select: { part_id: true }
      })
      
      if (part) {
        return {
          partId: part.part_id,
          confidence: 0.75,
          reasons: ['oem_match']
        }
      }
    }
  }

  return null
}

async function upsertSupplierProduct(
  providerId: number,
  queryBrand: string,
  item: DinamikStockItem
) {
  const key = `${queryBrand}::${item.stokKodu}`

  const existing = await db.supplier_products.findFirst({
    where: {
      provider_id: providerId,
      supplier_product_key: key
    },
    select: { id: true }
  })

  if (existing) {
    return db.supplier_products.update({
      where: { id: existing.id },
      data: {
        supplier_sku: item.stokKodu,
        supplier_brand: item.marka,
        supplier_name: item.stokAdi,
        normalized_sku: normalizeKey(item.stokKodu),
        normalized_name: normalizeKey(item.stokAdi),
        barcode_1: item.barkod1,
        barcode_2: item.barkod2,
        barcode_3: item.barkod3,
        supplier_price: toDecimal(item.fiyat),
        supplier_stock_qty: item.stokAdedi,
        currency: 'TRY',
        raw_json: item.raw as unknown as Prisma.InputJsonValue,
        last_seen_at: new Date()
      }
    })
  }

  return db.supplier_products.create({
    data: {
      provider_id: providerId,
      supplier_product_key: key,
      supplier_sku: item.stokKodu,
      supplier_brand: item.marka,
      supplier_name: item.stokAdi,
      normalized_sku: normalizeKey(item.stokKodu),
      normalized_name: normalizeKey(item.stokAdi),
      barcode_1: item.barkod1,
      barcode_2: item.barkod2,
      barcode_3: item.barkod3,
      supplier_price: toDecimal(item.fiyat),
      supplier_stock_qty: item.stokAdedi,
      currency: 'TRY',
      raw_json: item.raw as unknown as Prisma.InputJsonValue,
      last_seen_at: new Date()
    }
  })
}

async function upsertBrandAliasForCatalogSeed(providerId: number, supplierBrand: string) {
  const brandName = supplierBrand.trim()
  if (!brandName) return

  await db.supplier_brand_aliases.upsert({
    where: {
      provider_id_supplier_brand: {
        provider_id: providerId,
        supplier_brand: brandName
      }
    },
    update: {
      brand: brandName.toLocaleUpperCase('tr')
    },
    create: {
      provider_id: providerId,
      supplier_brand: brandName,
      brand: brandName.toLocaleUpperCase('tr'),
      mapping_status: 'PENDING',
      confidence: null
    }
  })
}

async function upsertSupplierProductBySku(
  providerId: number,
  queryBrand: string,
  item: DinamikStockItem
) {
  const supplierSku = item.stokKodu.trim()
  if (!supplierSku) {
    throw new Error('supplier_sku boş olamaz.')
  }

  const supplierProductKey = `${queryBrand}::${supplierSku}`

  return db.supplier_products.upsert({
    where: {
      provider_id_supplier_sku: {
        provider_id: providerId,
        supplier_sku: supplierSku
      }
    },
    update: {
      supplier_product_key: supplierProductKey,
      supplier_brand: normalizeText(item.marka) || queryBrand,
      supplier_name: item.stokAdi,
      normalized_sku: normalizeKey(supplierSku),
      normalized_name: normalizeKey(item.stokAdi),
      barcode_1: item.barkod1,
      barcode_2: item.barkod2,
      barcode_3: item.barkod3,
      supplier_price: toDecimal(item.fiyat),
      supplier_stock_qty: item.stokAdedi,
      currency: 'TRY',
      raw_json: item.raw as unknown as Prisma.InputJsonValue,
      last_seen_at: new Date()
    },
    create: {
      provider_id: providerId,
      supplier_product_key: supplierProductKey,
      supplier_sku: supplierSku,
      supplier_brand: normalizeText(item.marka) || queryBrand,
      supplier_name: item.stokAdi,
      normalized_sku: normalizeKey(supplierSku),
      normalized_name: normalizeKey(item.stokAdi),
      barcode_1: item.barkod1,
      barcode_2: item.barkod2,
      barcode_3: item.barkod3,
      supplier_price: toDecimal(item.fiyat),
      supplier_stock_qty: item.stokAdedi,
      currency: 'TRY',
      raw_json: item.raw as unknown as Prisma.InputJsonValue,
      last_seen_at: new Date()
    }
  })
}

/**
 * Batch upsert for supplier_products - uses parallel Prisma upserts
 * Simpler and more reliable than raw SQL for this use case
 */
async function batchUpsertSupplierProducts(
  providerId: number,
  queryBrand: string,
  items: DinamikStockItem[]
): Promise<Map<string, number>> {
  if (items.length === 0) return new Map()

  const skuToProductId = new Map<string, number>()
  const now = new Date()
  
  // Process in batches of 100 to avoid overwhelming the DB
  const batchSize = 100
  const upserts: Array<Promise<any>> = []
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    
    for (const item of batch) {
      const supplierSku = item.stokKodu.trim()
      if (!supplierSku) continue
      
      const supplierProductKey = `${queryBrand}::${supplierSku}`
      const supplierBrand = normalizeText(item.marka) || queryBrand
      
      const promise = db.supplier_products.upsert({
        where: {
          provider_id_supplier_sku: {
            provider_id: providerId,
            supplier_sku: supplierSku
          }
        },
        update: {
          supplier_product_key: supplierProductKey,
          supplier_brand: supplierBrand,
          supplier_name: item.stokAdi,
          normalized_sku: normalizeKey(supplierSku),
          normalized_name: normalizeKey(item.stokAdi),
          barcode_1: item.barkod1,
          barcode_2: item.barkod2,
          barcode_3: item.barkod3,
          supplier_price: toDecimal(item.fiyat),
          supplier_stock_qty: item.stokAdedi,
          currency: 'TRY',
          raw_json: item.raw as unknown as Prisma.InputJsonValue,
          last_seen_at: now
        },
        create: {
          provider_id: providerId,
          supplier_product_key: supplierProductKey,
          supplier_sku: supplierSku,
          supplier_brand: supplierBrand,
          supplier_name: item.stokAdi,
          normalized_sku: normalizeKey(supplierSku),
          normalized_name: normalizeKey(item.stokAdi),
          barcode_1: item.barkod1,
          barcode_2: item.barkod2,
          barcode_3: item.barkod3,
          supplier_price: toDecimal(item.fiyat),
          supplier_stock_qty: item.stokAdedi,
          currency: 'TRY',
          raw_json: item.raw as unknown as Prisma.InputJsonValue,
          last_seen_at: now
        }
      })
      
      upserts.push(promise)
    }
    
    // Execute batch
    const results = await Promise.all(upserts)
    for (const product of results) {
      if (product) {
        skuToProductId.set(product.supplier_sku, product.id)
      }
    }
    upserts.length = 0 // Clear array
  }
  
  // Handle any remaining
  if (upserts.length > 0) {
    const results = await Promise.all(upserts)
    for (const product of results) {
      if (product) {
        skuToProductId.set(product.supplier_sku, product.id)
      }
    }
  }

  return skuToProductId
}

/**
 * Delta sync: Fetch only products that have changed since last sync
 * Compares price and stock to determine if update is needed
 */
async function fetchChangedProducts(
  providerId: number,
  brand: string,
  items: DinamikStockItem[]
): Promise<DinamikStockItem[]> {
  if (items.length === 0) return []

  const skus = items.map((item) => item.stokKodu.trim())
  
  // Fetch existing products with their current price/stock
  const existingProducts = await db.supplier_products.findMany({
    where: {
      provider_id: providerId,
      supplier_sku: { in: skus }
    },
    select: {
      supplier_sku: true,
      supplier_price: true,
      supplier_stock_qty: true,
      updated_at: true
    }
  })

  const productMap = new Map(
    existingProducts.map((p) => [
      p.supplier_sku,
      {
        price: p.supplier_price?.toNumber() ?? null,
        stock: p.supplier_stock_qty,
        updatedAt: p.updated_at.getTime()
      }
    ])
  )

  // Filter to only items that have changed
  // Use 1 hour threshold to avoid re-processing recently synced items
  const staleThresholdMs = parseInt(process.env.DINAMIK_DELTA_SYNC_STALE_MS || '3600000', 10)
  const now = Date.now()
  
  return items.filter((item) => {
    const existing = productMap.get(item.stokKodu.trim())
    if (!existing) return true // New product, needs insert
    
    // Always refresh if old data (not synced within threshold)
    if (now - existing.updatedAt > staleThresholdMs) return true
    
    // Check if price or stock changed significantly
    // Using small tolerance for price comparisons to handle floating point issues
    const priceChanged = existing.price != null && 
      Math.abs((item.fiyat ?? 0) - existing.price) > 0.01
    const stockChanged = item.stokAdedi !== existing.stock
    
    return priceChanged || stockChanged
  })
}

async function upsertMappingForSupplierProduct(args: {
  providerId: number
  supplierProductId: number
  supplierSku: string
  preferredPartId: bigint | null
  confidence: number | null
  reasons: string[]
}) {
  const existing = await db.supplier_part_mappings.findFirst({
    where: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId
    }
  })

  const shouldAutoApprove =
    args.preferredPartId !== null &&
    args.confidence !== null &&
    args.confidence >= AUTO_APPROVE_CONFIDENCE

  const nextStatus = shouldAutoApprove ? 'APPROVED' : 'QUEUE'
  const matchReason = args.reasons.length > 0 ? args.reasons.join(',') : null

  if (existing?.status === 'APPROVED' && existing.part_id) {
    return existing
  }

  if (existing) {
    return db.supplier_part_mappings.update({
      where: { id: existing.id },
      data: {
        supplier_sku: args.supplierSku,
        part_id: args.preferredPartId,
        status: nextStatus,
        workflow_status: shouldAutoApprove ? 'MATCHED_EXISTING' : 'NEW',
        confidence: args.confidence != null ? new Prisma.Decimal(args.confidence) : null,
        match_reason: matchReason,
        is_manual: false,
        approved_by: shouldAutoApprove ? 'system:auto' : null,
        approved_at: shouldAutoApprove ? new Date() : null,
        ignored_reason: null
      }
    })
  }

  return db.supplier_part_mappings.create({
    data: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId,
      supplier_sku: args.supplierSku,
      part_id: args.preferredPartId,
      status: nextStatus,
      workflow_status: shouldAutoApprove ? 'MATCHED_EXISTING' : 'NEW',
      confidence: args.confidence != null ? new Prisma.Decimal(args.confidence) : null,
      match_reason: matchReason,
      is_manual: false,
      approved_by: shouldAutoApprove ? 'system:auto' : null,
      approved_at: shouldAutoApprove ? new Date() : null,
      ignored_reason: null
    }
  })
}

async function upsertPartOffer(args: {
  providerId: number
  supplierProductId: number
  partId: bigint
  price: number | null
  stockQty: number
  currency: string
  campaignRate: number
}) {
  const existing = await db.part_supplier_offers.findFirst({
    where: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId
    },
    select: { id: true }
  })

  if (existing) {
    await db.part_supplier_offers.update({
      where: { id: existing.id },
      data: {
        part_id: args.partId,
        supplier_price: toDecimal(args.price),
        supplier_stock_qty: args.stockQty,
        currency: args.currency,
        campaign_rate: new Prisma.Decimal(args.campaignRate),
        is_active: true,
        last_synced_at: new Date()
      }
    })
    return
  }

  await db.part_supplier_offers.create({
    data: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId,
      part_id: args.partId,
      supplier_price: toDecimal(args.price),
      supplier_stock_qty: args.stockQty,
      currency: args.currency,
      campaign_rate: new Prisma.Decimal(args.campaignRate),
      is_active: true,
      last_synced_at: new Date()
    }
  })
}

type OfferPolicyRow = {
  provider_id: number
  supplier_product_id: number
  supplier_price: string | null
  supplier_stock_qty: number
  currency: string
  priority: number
  campaign_rate: string | null
  provider_config: Prisma.JsonValue | null
}

export async function applyPolicyForPart(partId: bigint) {
  const offers = await db.$queryRaw<OfferPolicyRow[]>(Prisma.sql`
    SELECT
      o.provider_id,
      o.supplier_product_id,
      o.supplier_price::text AS supplier_price,
      o.supplier_stock_qty,
      o.currency,
      p.priority,
      o.campaign_rate::text AS campaign_rate,
      p.config AS provider_config
    FROM part_supplier_offers o
    JOIN supplier_providers p ON p.id = o.provider_id
    WHERE o.part_id = ${partId}
      AND o.is_active = TRUE
      AND p.status = 'ACTIVE'
    ORDER BY p.priority ASC, o.updated_at DESC
  `)

  const scoredOffers = offers.map((row) => {
    const policy = resolvePricingPolicyFromProviderConfig(row.provider_config)
    const calculation = calculateSellingPrice({
      supplierPrice: normalizeNumber(row.supplier_price),
      campaignRate: normalizeRate(row.campaign_rate, 0),
      policy
    })

    return {
      row,
      policy,
      calculation,
      hasStock: row.supplier_stock_qty > 0,
      netCost: calculation.netCostExVat ?? Number.POSITIVE_INFINITY
    }
  })

  scoredOffers.sort((a, b) => {
    if (a.hasStock !== b.hasStock) {
      return a.hasStock ? -1 : 1
    }

    if (a.netCost !== b.netCost) {
      return a.netCost - b.netCost
    }

    return a.row.priority - b.row.priority
  })

  const selected = scoredOffers[0] ?? null

  await db.part_pricing_inventory.upsert({
    where: { part_id: partId },
    update: {
      supplier_price: selected?.row.supplier_price
        ? new Prisma.Decimal(selected.row.supplier_price)
        : null,
      computed_cost_ex_vat:
        selected?.calculation.netCostExVat != null
          ? new Prisma.Decimal(selected.calculation.netCostExVat)
          : null,
      computed_selling_price_ex_vat:
        selected?.calculation.sellingExVat != null
          ? new Prisma.Decimal(selected.calculation.sellingExVat)
          : null,
      supplier_stock_qty: selected?.row.supplier_stock_qty ?? 0,
      sync_status: selected ? 'OK' : 'ERROR',
      source_provider_id: selected?.row.provider_id ?? null,
      source_supplier_product_id: selected?.row.supplier_product_id ?? null,
      currency: selected?.row.currency || 'TRY',
      last_synced_at: new Date(),
      last_policy_at: new Date()
    },
    create: {
      part_id: partId,
      supplier_price: selected?.row.supplier_price
        ? new Prisma.Decimal(selected.row.supplier_price)
        : null,
      computed_cost_ex_vat:
        selected?.calculation.netCostExVat != null
          ? new Prisma.Decimal(selected.calculation.netCostExVat)
          : null,
      computed_selling_price_ex_vat:
        selected?.calculation.sellingExVat != null
          ? new Prisma.Decimal(selected.calculation.sellingExVat)
          : null,
      supplier_stock_qty: selected?.row.supplier_stock_qty ?? 0,
      reserved_stock_qty: 0,
      min_stock_level: 3,
      sync_status: selected ? 'OK' : 'ERROR',
      source_provider_id: selected?.row.provider_id ?? null,
      source_supplier_product_id: selected?.row.supplier_product_id ?? null,
      currency: selected?.row.currency || 'TRY',
      last_synced_at: new Date(),
      last_policy_at: new Date()
    }
  })

  await db.part_admin_overrides.updateMany({
    where: {
      part_id: partId,
      lock_price: false
    },
    data: {
      selling_price_override: null
    }
  })

  await db.part_admin_overrides.updateMany({
    where: {
      part_id: partId,
      lock_visibility: false
    },
    data: {
      is_visible: true
    }
  })
}

export async function runDinamikSyncJob(
  options: DinamikSyncOptions = {}
): Promise<DinamikSyncResult> {
  const provider = await ensureDinamikProvider()
  const policyConcurrency = parseConcurrency(
    process.env.SUPPLIER_POLICY_CONCURRENCY,
    DEFAULT_POLICY_CONCURRENCY,
    64
  )
  const allBrands = options.brands && options.brands.length > 0
    ? options.brands
    : (await getBrandList()).map((item) => item.brand)

  const limit = options.limitBrands && options.limitBrands > 0 ? options.limitBrands : null
  const targetBrands = limit ? allBrands.slice(0, limit) : allBrands

  if (targetBrands.length === 0) {
    throw new Error('İşlenecek Dinamik markası bulunamadı.')
  }

  const run = await db.supplier_sync_runs.create({
    data: {
      provider_id: provider.id,
      trigger_type: options.triggerType || 'MANUAL',
      endpoint: 'getStockList,getPriceList',
      status: 'RUNNING',
      started_at: new Date(),
      meta: {
        brandCount: targetBrands.length
      }
    }
  })

  let totalCount = 0
  let successCount = 0
  let failedCount = 0
  let mappingMissCount = 0
  const errors: string[] = []
  const brands: SyncBrandSummary[] = []
  const affectedParts = new Set<bigint>()

  try {
    for (const brand of targetBrands) {
      let staged = 0
      let approved = 0
      let queued = 0
      let offerCount = 0

      try {
        const [stockRows, priceRows] = await Promise.all([
          getStockList(brand),
          getPriceList(brand)
        ])

        const merged = new Map<string, DinamikStockItem>(
          mergeDinamikStockAndPriceRows(stockRows, priceRows).map((item) => [
            item.stokKodu,
            item
          ])
        )

        const brandAliasCache = new Map<string, number | null>()

        for (const item of Array.from(merged.values())) {
          totalCount += 1
          const supplierBrand = item.marka || brand

          if (!brandAliasCache.has(supplierBrand || brand)) {
            const aliasPartBrandId = await ensureBrandAlias(provider.id, supplierBrand || brand)
            brandAliasCache.set(supplierBrand || brand, aliasPartBrandId)
          }

          const partBrandId = brandAliasCache.get(supplierBrand || brand) ?? null
          const supplierProduct = await upsertSupplierProductBySku(provider.id, brand, item)
          await syncSupplierProductApiOems({
            providerId: provider.id,
            supplierProductId: supplierProduct.id,
            supplierBrand,
            raw: item.raw
          })
          const activeOems = await getActiveSupplierOems(provider.id, supplierProduct.id)
          staged += 1
          successCount += 1

          const candidate = await findBestCandidate(item, partBrandId, activeOems)
          const mapping = await upsertMappingForSupplierProduct({
            providerId: provider.id,
            supplierProductId: supplierProduct.id,
            supplierSku: item.stokKodu,
            preferredPartId: candidate?.partId ?? null,
            confidence: candidate?.confidence ?? null,
            reasons: candidate?.reasons ?? []
          })

          if (mapping.status === 'APPROVED' && mapping.part_id) {
            approved += 1
            await upsertPartOffer({
              providerId: provider.id,
              supplierProductId: supplierProduct.id,
              partId: mapping.part_id,
              price: item.fiyat,
              stockQty: item.stokAdedi,
              currency: 'TRY',
              campaignRate: item.campaignRate
            })
            await ensureSupplierMappingCrossReference({
              partId: mapping.part_id,
              providerCode: provider.code,
              supplierSku: item.stokKodu
            })
            offerCount += 1
            affectedParts.add(mapping.part_id)
          } else {
            queued += 1
            mappingMissCount += 1
          }
        }

        brands.push({
          brand,
          fetched: merged.size,
          staged,
          approved,
          queued,
          offers: offerCount
        })
      } catch (error) {
        failedCount += 1
        const errorClass = classifyError(error)
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`[${brand}] (${errorClass}) ${message}`)
      }
    }

    await mapWithConcurrency(
      Array.from(affectedParts),
      policyConcurrency,
      async (partId) => applyPolicyForPart(partId)
    )

    await deleteCachePattern('catalog:prices:*')
    await scheduleSearchIndexUpdate(Array.from(affectedParts))

    const status: DinamikSyncResult['status'] =
      failedCount === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED'

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status,
        ended_at: new Date(),
        total_count: totalCount,
        success_count: successCount,
        failed_count: failedCount,
        error_summary: errors.length > 0 ? errors.slice(0, 20).join(' | ') : null,
        meta: {
          brands,
          mappingMissCount,
          affectedParts: affectedParts.size
        }
      }
    })

    await db.supplier_providers.update({
      where: { id: provider.id },
      data: {
        last_sync_at: new Date()
      }
    })

    return {
      runId: run.id,
      providerId: provider.id,
      status,
      totalCount,
      successCount,
      failedCount,
      mappingMissCount,
      brands,
      errors
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        ended_at: new Date(),
        total_count: totalCount,
        success_count: successCount,
        failed_count: Math.max(failedCount, 1),
        error_summary: message
      }
    })

    throw error
  }
}

export async function runDinamikCatalogSeedJob(
  options: DinamikCatalogSeedOptions = {}
): Promise<DinamikCatalogSeedResult> {
  const provider = await ensureDinamikProvider()
  const triggerType = options.triggerType || 'MANUAL'
  const mode: SyncMode = options.mode || 'full'
  const brandConcurrency = parseConcurrency(
    process.env.DINAMIK_BRAND_CONCURRENCY,
    DEFAULT_BRAND_CONCURRENCY,
    12
  )
  const itemConcurrency = parseConcurrency(
    process.env.DINAMIK_ITEM_CONCURRENCY,
    DEFAULT_ITEM_CONCURRENCY,
    64
  )
  const policyConcurrency = parseConcurrency(
    process.env.SUPPLIER_POLICY_CONCURRENCY,
    DEFAULT_POLICY_CONCURRENCY,
    64
  )
  const requestedBrand = options.brand?.trim() || null
  const limit =
    options.limitBrands && options.limitBrands > 0
      ? Math.min(options.limitBrands, 5000)
      : null

  const brandsFromApi = (await getBrandList())
    .map((item) => item.brand.trim())
    .filter((brand) => brand.length > 0)

  const uniqueBrands = Array.from(new Set(brandsFromApi))
  await mapWithConcurrency(uniqueBrands, brandConcurrency, async (brand) =>
    upsertBrandAliasForCatalogSeed(provider.id, brand)
  )

  const aliasRows = await db.supplier_brand_aliases.findMany({
    where: {
      provider_id: provider.id,
      ...(requestedBrand
        ? {
            supplier_brand: {
              equals: requestedBrand,
              mode: 'insensitive' as const
            }
          }
        : {})
    },
    select: {
      supplier_brand: true
    },
    orderBy: {
      supplier_brand: 'asc'
    },
    ...(limit ? { take: limit } : {})
  })

  const targetBrands = aliasRows
    .map((row) => row.supplier_brand.trim())
    .filter((brand) => brand.length > 0)

  if (targetBrands.length === 0) {
    throw new Error('İşlenecek Dinamik markası bulunamadı.')
  }

  const run = await db.supplier_sync_runs.create({
    data: {
      provider_id: provider.id,
      trigger_type: triggerType,
      endpoint: mode === 'delta' ? 'getStockList' : 'getBrandList,getStockList',
      status: 'RUNNING',
      started_at: new Date(),
      meta: {
        mode: 'CATALOG_SEED',
        syncMode: mode,
        brandCount: targetBrands.length,
        requestedBrand,
        limitedTo: limit
      }
    }
  })

  let totalCount = 0
  let successCount = 0
  let failedCount = 0
  let mappingMissCount = 0
  let approvedMappingCount = 0
  let offerCount = 0
  const errors: string[] = []
  const brands: CatalogSeedBrandSummary[] = []
  const affectedParts = new Set<bigint>()

  try {
    const brandResults = await mapWithConcurrency(
      targetBrands,
      brandConcurrency,
      async (brand) => {
        let fetched = 0
        let seeded = 0
        let failed = 0
        let mappingMiss = 0
        let approved = 0
        let offers = 0
        const partIds: bigint[] = []
        const brandErrors: string[] = []
        let processedCount = 0

        try {
          const stockRows = await getStockList(brand)
          fetched = stockRows.length
          processedCount = stockRows.length

          // Delta sync: Only process changed products
          let itemsToProcess = stockRows
          if (mode === 'delta') {
            itemsToProcess = await fetchChangedProducts(provider.id, brand, stockRows)
          }

          if (itemsToProcess.length === 0) {
            // No changes, skip this brand
            return {
              summary: {
                brand,
                fetched,
                seeded: 0,
                failed: 0
              } satisfies CatalogSeedBrandSummary,
              totalCount: processedCount,
              successCount: 0,
              failedCount: 0,
              mappingMissCount: 0,
              approvedMappingCount: 0,
              offerCount: 0,
              partIds: [],
              errors: []
            }
          }

          // Batch upsert products
          const skuToProductId = await batchUpsertSupplierProducts(
            provider.id,
            brand,
            itemsToProcess
          )

          // Prepare OEM data for batch sync
          const productsForOemSync: Array<{
            supplierProductId: number
            supplierBrand: string | null
            raw: Record<string, unknown>
          }> = []

          // Build brand alias cache
          const brandAliasCache = new Map<string, Promise<number | null>>()
          const resolvePartBrandId = async (supplierBrand: string) => {
            const normalized = supplierBrand.trim().toLocaleUpperCase('tr')
            const cached = brandAliasCache.get(normalized)
            if (cached) return cached
            const result = ensureBrandAlias(provider.id, supplierBrand)
            brandAliasCache.set(normalized, result)
            return result
          }

          // Process products with SIMPLE mapping (article_link only)
          for (const item of itemsToProcess) {
            try {
              const supplierProductId = skuToProductId.get(item.stokKodu.trim())
              if (!supplierProductId) continue

              const supplierBrand = item.marka || brand
              const partBrandId = await resolvePartBrandId(supplierBrand)
              
              seeded += 1

              // Simple mapping: Extract numeric part and match by article_link_id
              const sku = item.stokKodu.trim()
              let mappingDone = false
              
              // Extract numeric part from SKU (e.g., "AYD 50150" -> "50150")
              const numericMatch = sku.match(/(\d{4,})/)
              const numericSku = numericMatch ? numericMatch[1] : null
              
              if (numericSku) {
                // Try direct article_link_id match
                try {
                  const articleLinkId = BigInt(numericSku)
                  const part = await db.parts.findFirst({
                    where: { 
                      article_link_id: articleLinkId,
                      ...(partBrandId ? { brand_id: partBrandId } : {})
                    },
                    select: { id: true }
                  })
                  
                  if (part) {
                    // Found match - create mapping and offer
                    const mapping = await upsertMappingForSupplierProduct({
                      providerId: provider.id,
                      supplierProductId,
                      supplierSku: sku,
                      preferredPartId: part.id,
                      confidence: 0.95,
                      reasons: ['article_link_exact']
                    })
                    
                    if (mapping.status === 'APPROVED') {
                      approved += 1
                      await upsertPartOffer({
                        providerId: provider.id,
                        supplierProductId,
                        partId: part.id,
                        price: item.fiyat,
                        stockQty: item.stokAdedi,
                        currency: 'TRY',
                        campaignRate: item.campaignRate
                      })
                      offers += 1
                      partIds.push(part.id)
                      mappingDone = true
                    }
                  }
                } catch {
                  // Skip invalid SKU
                }
              }
              
              if (!mappingDone) {
                mappingMiss += 1
              }
            } catch (error) {
              failed += 1
              const errorClass = classifyError(error)
              const message = error instanceof Error ? error.message : String(error)
              brandErrors.push(`[${brand}/${item.stokKodu}] (${errorClass}) ${message}`)
            }
          }
        } catch (error) {
          failed += 1
          const errorClass = classifyError(error)
          const message = error instanceof Error ? error.message : String(error)
          brandErrors.push(`[${brand}] (${errorClass}) ${message}`)
        }

        return {
          summary: {
            brand,
            fetched,
            seeded,
            failed
          } satisfies CatalogSeedBrandSummary,
          totalCount: processedCount,
          successCount: seeded,
          failedCount: failed,
          mappingMissCount: mappingMiss,
          approvedMappingCount: approved,
          offerCount: offers,
          partIds,
          errors: brandErrors
        }
      }
    )

    for (const brandResult of brandResults) {
      brands.push(brandResult.summary)
      totalCount += brandResult.totalCount
      successCount += brandResult.successCount
      failedCount += brandResult.failedCount
      mappingMissCount += brandResult.mappingMissCount
      approvedMappingCount += brandResult.approvedMappingCount
      offerCount += brandResult.offerCount
      errors.push(...brandResult.errors)
      for (const partId of brandResult.partIds) {
        affectedParts.add(partId)
      }
    }

    const shouldRunStalePolicy = mode === 'full' && !requestedBrand && !limit
    if (shouldRunStalePolicy) {
      const staleDaysRaw = Number(process.env.SUPPLIER_STALE_DAYS || DEFAULT_STALE_DAYS)
      const staleDays = Number.isFinite(staleDaysRaw) && staleDaysRaw > 0
        ? Math.trunc(staleDaysRaw)
        : DEFAULT_STALE_DAYS
      const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000)
      const stalePartIds = await deactivateStaleOffersForProvider({
        providerId: provider.id,
        staleBefore
      })
      for (const partId of stalePartIds) {
        affectedParts.add(partId)
      }
    }

    await mapWithConcurrency(
      Array.from(affectedParts),
      policyConcurrency,
      async (partId) => applyPolicyForPart(partId)
    )

    await deleteCachePattern('catalog:prices:*')
    await scheduleSearchIndexUpdate(Array.from(affectedParts))

    const status: DinamikCatalogSeedResult['status'] =
      failedCount === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED'

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status,
        ended_at: new Date(),
        total_count: totalCount,
        success_count: successCount,
        failed_count: failedCount,
        error_summary: errors.length > 0 ? errors.slice(0, 20).join(' | ') : null,
        meta: {
          mode: 'CATALOG_SEED',
          syncMode: mode,
          brandCount: targetBrands.length,
          requestedBrand,
          limitedTo: limit,
          errorCount: errors.length,
          mappingMissCount,
          approvedMappingCount,
          offerCount,
          policyUpdatedCount: affectedParts.size,
          brands
        }
      }
    })

    await db.supplier_providers.update({
      where: { id: provider.id },
      data: {
        last_sync_at: new Date()
      }
    })

    return {
      runId: run.id,
      providerId: provider.id,
      status,
      brandCount: targetBrands.length,
      totalCount,
      successCount,
      failedCount,
      errorCount: errors.length,
      mappingMissCount,
      approvedMappingCount,
      offerCount,
      policyUpdatedCount: affectedParts.size,
      brands,
      errors
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        ended_at: new Date(),
        total_count: totalCount,
        success_count: successCount,
        failed_count: Math.max(failedCount, 1),
        error_summary: message,
        meta: {
          mode: 'CATALOG_SEED',
          syncMode: mode,
          brandCount: targetBrands.length,
          requestedBrand,
          limitedTo: limit,
          errorCount: errors.length,
          mappingMissCount,
          approvedMappingCount,
          offerCount,
          policyUpdatedCount: affectedParts.size
        }
      }
    })

    throw error
  }
}

export async function refreshDinamikSkuStock(stockCode: string) {
  return getStockBySku(stockCode)
}

export function mapSupplierProductPrice(value: Prisma.Decimal | null | undefined) {
  return value ? Number(value.toString()) : null
}

export function mapDate(value: Date | null | undefined) {
  return toIso(value)
}
