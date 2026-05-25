import { Prisma } from '@prisma/client'
import { batchUpsertDproductOffers } from '@/lib/admin/dproduct-offers'
import { deriveDproductsPartNo } from '@/lib/admin/dproducts-part-no'
import { db } from '@/lib/db'
import { getPriceList, getStockList, type DinamikStockItem } from '@/lib/suppliers/dinamik-client'
import { mergeDinamikItemsBySku } from '@/lib/suppliers/dinamik-stock'
import type {
  DproductsBrandSyncSummary,
  DproductsStockSyncResult
} from '@/lib/types/dproducts-sync'

export type { DproductsBrandSyncSummary, DproductsStockSyncResult } from '@/lib/types/dproducts-sync'

const BATCH_SIZE = 400
const DEFAULT_BRAND_CONCURRENCY = 3
const BRAND_SYNC_RETRY_DELAY_MS = 2_000

function isRetryableDinamikSyncError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('dinamik api isteği başarısız') ||
    lower.includes('zaman aşımı') ||
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('socket') ||
    lower.includes('connect')
  )
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function parseConcurrency(
  value: string | undefined,
  fallback: number,
  maxValue = 8
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

export { deriveDproductsPartNo } from '@/lib/admin/dproducts-part-no'

function dedupeItemsBySku(items: DinamikStockItem[]): DinamikStockItem[] {
  const bySku = new Map<string, DinamikStockItem>()
  for (const item of items) {
    const sku = item.stokKodu?.trim()
    if (sku) bySku.set(sku, item)
  }
  return Array.from(bySku.values())
}

function mapItemToDproductMasterRow(queryBrand: string, item: DinamikStockItem) {
  const stockCode = item.stokKodu.trim()
  return {
    stock_code: stockCode,
    stock_name: item.stokAdi,
    brand: item.marka?.trim() || queryBrand,
    query_brand: queryBrand,
    part_no: deriveDproductsPartNo(stockCode),
    barcode_1: item.barkod1,
    barcode_2: item.barkod2,
    barcode_3: item.barkod3
  }
}

export async function fetchDinamikItemsForBrand(
  queryBrand: string,
  options?: { fetchPrices?: boolean }
): Promise<DinamikStockItem[]> {
  const stockRows = await getStockList(queryBrand)
  if (options?.fetchPrices === false) {
    return dedupeItemsBySku(stockRows)
  }

  try {
    const priceRows = await getPriceList(queryBrand)
    return dedupeItemsBySku(mergeDinamikItemsBySku(stockRows, priceRows))
  } catch {
    return dedupeItemsBySku(stockRows)
  }
}

/** Mark every row for the brand passive before applying the latest API snapshot. */
export async function markDproductsBrandPassive(
  queryBrand: string,
  dryRun: boolean
): Promise<number> {
  if (dryRun) {
    const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM parcatedarik.dproducts
      WHERE query_brand = ${queryBrand}
        AND is_passive = false
    `)
    return row?.count ?? 0
  }

  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE parcatedarik.dproducts
    SET
      is_passive = true,
      passive_at = NOW(),
      updated_at = NOW()
    WHERE query_brand = ${queryBrand}
      AND is_passive = false
  `)
  return Number(updated)
}

export async function batchUpsertDproducts(
  queryBrand: string,
  items: DinamikStockItem[],
  dryRun: boolean
): Promise<number> {
  const deduped = dedupeItemsBySku(items)
  const rows = deduped.map((item) => mapItemToDproductMasterRow(queryBrand, item))
  if (rows.length === 0) return 0
  if (dryRun) return rows.length

  let upserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch.map(
      (row) =>
        Prisma.sql`(
          ${row.stock_code},
          ${row.stock_name},
          ${row.brand},
          ${row.barcode_1},
          ${row.barcode_2},
          ${row.barcode_3},
          ${row.query_brand},
          ${row.part_no},
          '{}'::jsonb,
          NOW(),
          NOW(),
          false,
          NULL::timestamptz
        )`
    )

    const count = await db.$executeRaw(Prisma.sql`
      INSERT INTO parcatedarik.dproducts (
        stock_code,
        stock_name,
        brand,
        barcode_1,
        barcode_2,
        barcode_3,
        query_brand,
        part_no,
        raw,
        updated_at,
        last_seen_at,
        is_passive,
        passive_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (query_brand, stock_code) DO UPDATE SET
        stock_name = EXCLUDED.stock_name,
        brand = EXCLUDED.brand,
        barcode_1 = EXCLUDED.barcode_1,
        barcode_2 = EXCLUDED.barcode_2,
        barcode_3 = EXCLUDED.barcode_3,
        part_no = COALESCE(EXCLUDED.part_no, parcatedarik.dproducts.part_no),
        updated_at = NOW(),
        is_passive = false,
        passive_at = NULL
    `)
    upserted += Number(count)
  }

  await batchUpsertDproductOffers(queryBrand, deduped, dryRun)

  return upserted
}

async function syncDproductsForBrandOnce(
  brand: string,
  options?: { dryRun?: boolean; fetchPrices?: boolean }
): Promise<DproductsBrandSyncSummary> {
  const dryRun = options?.dryRun !== false

  const items = await fetchDinamikItemsForBrand(brand, {
    fetchPrices: options?.fetchPrices !== false
  })

  const markedPassive = await markDproductsBrandPassive(brand, dryRun)
  const upserted = await batchUpsertDproducts(brand, items, dryRun)

  return {
    brand,
    fetched: items.length,
    upserted,
    markedPassive,
    failed: false
  }
}

export async function syncDproductsForBrand(
  queryBrand: string,
  options?: { dryRun?: boolean; fetchPrices?: boolean }
): Promise<DproductsBrandSyncSummary> {
  const brand = queryBrand.trim()

  const fail = (error: unknown): DproductsBrandSyncSummary => {
    const message = error instanceof Error ? error.message : String(error)
    return {
      brand,
      fetched: 0,
      upserted: 0,
      markedPassive: 0,
      failed: true,
      error: message
    }
  }

  try {
    return await syncDproductsForBrandOnce(brand, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isRetryableDinamikSyncError(message)) {
      return fail(error)
    }

    await sleep(BRAND_SYNC_RETRY_DELAY_MS)

    try {
      return await syncDproductsForBrandOnce(brand, options)
    } catch (retryError) {
      return fail(retryError)
    }
  }
}

export async function listDbrandsForDproductsSync(input?: {
  brand?: string | null
  limitBrands?: number | null
}): Promise<string[]> {
  const requested = input?.brand?.trim()
  if (requested) return [requested]

  const limit =
    input?.limitBrands && input.limitBrands > 0
      ? Math.min(input.limitBrands, 5000)
      : null

  const rows = await db.dbrands.findMany({
    select: { brand: true },
    orderBy: { brand: 'asc' },
    ...(limit ? { take: limit } : {})
  })

  return rows.map((row) => row.brand.trim()).filter((brand) => brand.length > 0)
}

export async function syncDproductsFromDbrands(options?: {
  dryRun?: boolean
  brand?: string | null
  limitBrands?: number | null
  fetchPrices?: boolean
  brandConcurrency?: number
}): Promise<DproductsStockSyncResult> {
  const dryRun = options?.dryRun !== false
  const brands = await listDbrandsForDproductsSync({
    brand: options?.brand,
    limitBrands: options?.limitBrands
  })

  if (brands.length === 0) {
    throw new Error('İşlenecek dbrands kaydı bulunamadı.')
  }

  const concurrency = parseConcurrency(
    process.env.DINAMIK_DPRODUCTS_BRAND_CONCURRENCY,
    options?.brandConcurrency ?? DEFAULT_BRAND_CONCURRENCY,
    6
  )

  const summaries = await mapWithConcurrency(brands, concurrency, (brand) =>
    syncDproductsForBrand(brand, {
      dryRun,
      fetchPrices: options?.fetchPrices !== false
    })
  )

  const errors = summaries
    .filter((row) => row.failed && row.error)
    .map((row) => `${row.brand}: ${row.error}`)

  return {
    dryRun,
    brandsTotal: brands.length,
    brandsProcessed: summaries.length,
    fetchedTotal: summaries.reduce((sum, row) => sum + row.fetched, 0),
    upsertedTotal: summaries.reduce((sum, row) => sum + row.upserted, 0),
    markedPassiveTotal: summaries.reduce((sum, row) => sum + row.markedPassive, 0),
    failedBrands: summaries.filter((row) => row.failed).length,
    brands: summaries,
    errors
  }
}
