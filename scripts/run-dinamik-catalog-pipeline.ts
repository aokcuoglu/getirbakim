/**
 * Full Dinamik catalog pipeline (dnbrd → dnprd per brand → dpbrd).
 *
 *   bun scripts/run-dinamik-catalog-pipeline.ts
 *   SKIP_DPRODUCTS=true bun scripts/run-dinamik-catalog-pipeline.ts
 *   DPRODUCTS_ONLY_BRAND='BOSCH' bun scripts/run-dinamik-catalog-pipeline.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const CRON_SECRET = process.env.CRON_SECRET?.trim()
const SKIP_DPRODUCTS = process.env.SKIP_DPRODUCTS === 'true'
const ONLY_BRAND = process.env.DPRODUCTS_ONLY_BRAND?.trim()
const BRAND_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.PIPELINE_BRAND_CONCURRENCY || '2') || 2)
)

async function cronGet(path: string): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` }
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function syncBrandDproducts(brand: string): Promise<{
  brand: string
  ok: boolean
  fetched?: number
  upserted?: number
  markedPassive?: number
  error?: string
}> {
  const params = new URLSearchParams({ brand, apply: 'true' })
  const url = `${BASE_URL}/api/internal/suppliers/dinamik/dnprd-sync?${params}`

  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${CRON_SECRET}` }
    })
    const text = await response.text()
    if (!response.ok) {
      return { brand, ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    }

    let result: Record<string, unknown> | null = null
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const row = JSON.parse(line) as { phase?: string }
        if (row.phase === 'result') result = row as Record<string, unknown>
      } catch {
        // ignore
      }
    }

    const failed = Number(result?.failedBrands ?? 0)
    if (failed > 0) {
      const errors = result?.errors as string[] | undefined
      return { brand, ok: false, error: errors?.[0] || 'sync failed' }
    }

    return {
      brand,
      ok: true,
      fetched: Number(result?.fetchedTotal ?? 0),
      upserted: Number(result?.upsertedTotal ?? 0),
      markedPassive: Number(result?.markedPassiveTotal ?? 0)
    }
  } catch (error) {
    return {
      brand,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function runWorker() {
    while (index < items.length) {
      const i = index++
      results[i] = await worker(items[i])
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
  return results
}

async function main() {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET gerekli.')
    process.exit(1)
  }

  console.log(
    '[pipeline] 1/3 dnbrd reconcile (API upsert; API dışı üretici kopyaları temizlenir)'
  )
  const reconcile = (await cronGet(
    '/api/internal/suppliers/dinamik/dnbrd-reconcile?apply=true&syncFromApi=true'
  )) as {
    removedManufacturerOnly?: number
    insertedFromApi?: number
    audit?: { manufacturerOnlyInDbrands?: number; dnbrdTotal?: number }
  }
  console.log(
    JSON.stringify(
      {
        removedNonApiManufacturerDupes: reconcile.removedManufacturerOnly,
        apiInserted: reconcile.insertedFromApi,
        dnbrdTotal: reconcile.audit?.dnbrdTotal,
        manufacturerOnly: reconcile.audit?.manufacturerOnlyInDbrands
      },
      null,
      2
    )
  )

  if (SKIP_DPRODUCTS) {
    console.log('[pipeline] dnprd atlandı (SKIP_DPRODUCTS=true)')
  } else {
    const brands = ONLY_BRAND
      ? [ONLY_BRAND]
      : (
          await db.supplier_dinamik_brands.findMany({
            select: { brand: true },
            orderBy: { brand: 'asc' }
          })
        ).map((row) => row.brand.trim()).filter(Boolean)

    console.log(`[pipeline] 2/3 dnprd sync (${brands.length} marka, concurrency=${BRAND_CONCURRENCY})`)
    let done = 0
    let failed = 0
    let fetchedTotal = 0
    let upsertedTotal = 0
    let passiveTotal = 0

    const results = await mapPool(brands, BRAND_CONCURRENCY, async (brand) => {
      const row = await syncBrandDproducts(brand)
      done += 1
      if (row.ok) {
        fetchedTotal += row.fetched ?? 0
        upsertedTotal += row.upserted ?? 0
        passiveTotal += row.markedPassive ?? 0
        if (done % 25 === 0 || done === brands.length) {
          console.log(
            `[pipeline] dnprd ${done}/${brands.length} — son: ${brand} (+${row.fetched ?? 0} satır)`
          )
        }
      } else {
        failed += 1
        console.error(`[pipeline] HATA ${brand}: ${row.error}`)
      }
      return row
    })

    let failedRows = results.filter((row) => !row.ok)
    if (failedRows.length > 0) {
      console.log(`[pipeline] ${failedRows.length} marka yeniden deneniyor...`)
      const retried = await mapPool(failedRows, 1, async (row) => {
        const retry = await syncBrandDproducts(row.brand)
        if (retry.ok) {
          fetchedTotal += retry.fetched ?? 0
          upsertedTotal += retry.upserted ?? 0
          passiveTotal += retry.markedPassive ?? 0
          failed -= 1
          console.log(
            `[pipeline] yeniden deneme OK ${row.brand} (+${retry.fetched ?? 0} satır)`
          )
        } else {
          console.error(`[pipeline] yeniden deneme HATA ${row.brand}: ${retry.error}`)
        }
        return retry
      })
      for (let i = 0; i < results.length; i += 1) {
        const brand = results[i].brand
        const retryRow = retried.find((r) => r.brand === brand)
        if (retryRow?.ok) results[i] = retryRow
      }
      failedRows = results.filter((row) => !row.ok)
    }

    console.log('[pipeline] dnprd özet:', {
      brands: brands.length,
      ok: brands.length - failedRows.length,
      failed: failedRows.length,
      fetchedTotal,
      upsertedTotal,
      passiveTotal
    })
    if (failedRows.length > 0) {
      console.log('[pipeline] ilk 10 hata:', failedRows.slice(0, 10))
    }
  }

  console.log('[pipeline] 3/3 dpbrd seed')
  const match = (await cronGet(
    '/api/internal/suppliers/dinamik/dnbrd-match?apply=true&runAutoMatch=true'
  )) as { matchTotalAfter?: number; insertedAutoMatched?: number }
  console.log(JSON.stringify(match, null, 2))

  console.log('[pipeline] Tamamlandı.')
}

main().catch((error) => {
  console.error('[pipeline] Failed:', error)
  process.exit(1)
})
