import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

const { mock } = await import('bun:test') as any

mock.module('@/lib/suppliers/dinamik-catalog-seed', () => ({
  runDinamikCatalogSeed: mock(() =>
    Promise.resolve({ status: 'SUCCESS', brandCount: 0, totalCount: 0, successCount: 0, failedCount: 0, offerCount: 0, runId: 0 })
  )
}))

const { handleDinamikCatalogSeedRequest } = await import('./handler')

describe('GET /api/internal/suppliers/dinamik/catalog-seed', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET == null) {
      delete process.env.CRON_SECRET
      return
    }
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
  })

  it('returns 401 when authorization header is missing', async () => {
    const response = await handleDinamikCatalogSeedRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/dinamik/catalog-seed'
      )
    )
    expect(response.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const response = await handleDinamikCatalogSeedRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/dinamik/catalog-seed',
        { headers: { authorization: 'Bearer wrong' } }
      )
    )
    expect(response.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET
    const response = await handleDinamikCatalogSeedRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/dinamik/catalog-seed',
        { headers: { authorization: 'Bearer test-secret' } }
      )
    )
    expect(response.status).toBe(500)
  })

  it('returns streaming response with correct content type on valid auth', async () => {
    const response = await handleDinamikCatalogSeedRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/dinamik/catalog-seed?brand=TEST',
        { headers: { authorization: 'Bearer test-secret' } }
      )
    )

    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
  })
})