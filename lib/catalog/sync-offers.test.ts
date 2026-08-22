import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PartnerOrderError, assertOfferFresh } from '@/lib/partner/order-contract'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'sync-offers.ts'), 'utf8')
const dinamikIngestionSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../admin/dnprd-details.ts'), 'utf8')

function captureCode(fn: () => unknown): string | null {
  try { fn(); return null } catch (error) {
    return error instanceof PartnerOrderError ? error.code : 'unexpected'
  }
}

describe('offer freshness projection', () => {
  it('projects exact Dinamik cost ingestion time as transactional freshness', () => {
    expect(source).toContain('dc.last_seen_at AS source_priced_at')
    expect(source).toContain('priced_at = src.source_priced_at')
    expect(dinamikIngestionSource).toContain('WHEN EXCLUDED.price IS NOT NULL THEN NOW()')
    expect(dinamikIngestionSource).toContain('ELSE catalog.supplier_dinamik_cost.last_seen_at')

    const ingestedAt = new Date('2026-08-22T12:00:00Z')
    assertOfferFresh(ingestedAt, new Date('2026-08-22T12:00:05Z'), new Date('2026-08-22T12:00:30Z'), 60)
  })

  it('keeps an untouched stale Basbug source stale after global projection', () => {
    expect(source).toContain('bp.last_seen_at AS source_priced_at')
    expect(captureCode(() => assertOfferFresh(
      new Date('2026-08-20T12:00:00Z'),
      new Date('2026-08-22T12:00:00Z'),
      new Date('2026-08-22T12:00:01Z'),
      86400
    ))).toBe('OFFER_EXPIRED')
  })

  it('records projection time separately without manufacturing freshness', () => {
    expect(/priced_at\s*=\s*NOW\(\)/.test(source)).toBe(false)
    expect(source.match(/last_synced_at\s*=\s*NOW\(\)/g)).toHaveLength(2)

    const unchangedSourceTime = new Date('2026-08-20T12:00:00Z')
    const projectionTime = new Date('2026-08-22T12:00:00Z')
    expect(captureCode(() => assertOfferFresh(
      unchangedSourceTime, projectionTime, new Date('2026-08-22T12:00:01Z'), 86400
    ))).toBe('OFFER_EXPIRED')
  })
})
