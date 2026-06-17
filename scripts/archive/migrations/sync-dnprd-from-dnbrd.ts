/**
 * Trigger Dinamik dnprd sync via internal API (server-only Dinamik client).
 *
 *   BASE_URL=http://localhost:3001 CRON_SECRET=... APPLY=true BRAND='KRAFTVOLL FREN AYNASI' \\
 *     bun scripts/sync-dnprd-from-dnbrd.ts
 *
 *   APPLY=true LIMIT_BRANDS=10 bun scripts/sync-dnprd-from-dnbrd.ts
 *
 * Tek marka / önizleme için admin panel: getStockList → dnprd veya dnprd doldur.
 */

import 'dotenv/config'

const APPLY = process.env.APPLY === 'true'
const BRAND = process.env.BRAND?.trim() || undefined
const LIMIT_BRANDS = Number(process.env.LIMIT_BRANDS || '')
const limitBrands =
  Number.isFinite(LIMIT_BRANDS) && LIMIT_BRANDS > 0 ? LIMIT_BRANDS : undefined
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const CRON_SECRET = process.env.CRON_SECRET?.trim()

async function main() {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET gerekli.')
    process.exit(1)
  }

  const params = new URLSearchParams()
  if (BRAND) params.set('brand', BRAND)
  if (limitBrands) params.set('limitBrands', String(limitBrands))
  if (APPLY) params.set('apply', 'true')
  if (process.env.FETCH_PRICES === 'false') params.set('fetchPrices', 'false')

  const url = `${BASE_URL}/api/internal/suppliers/dinamik/dnprd-sync?${params}`
  console.log(`[sync-dnprd-from-dnbrd] GET ${url}`)

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${CRON_SECRET}` }
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`HTTP ${response.status}: ${body}`)
    process.exit(1)
  }

  const text = await response.text()
  for (const line of text.split('\n').filter(Boolean)) {
    console.log(line)
    try {
      const row = JSON.parse(line) as { phase?: string; failedBrands?: number }
      if (row.phase === 'result' && row.failedBrands && row.failedBrands > 0) {
        process.exit(1)
      }
    } catch {
      // ignore non-json lines
    }
  }

  console.log()
  console.log(APPLY ? 'APPLY tamamlandı.' : 'DRY_RUN — apply=true ekleyin.')
}

main().catch((error) => {
  console.error('[sync-dnprd-from-dnbrd] Failed:', error)
  process.exit(1)
})
