import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { mock } = (await import('bun:test')) as any

mock.module('@/lib/admin/dproducts-stock-sync', () => ({
  syncDproductsFromDbrands: mock(() =>
    Promise.resolve({
      dryRun: true,
      brandsTotal: 1,
      brandsProcessed: 1,
      fetchedTotal: 0,
      upsertedTotal: 0,
      failedBrands: 0,
      brands: [],
      errors: []
    })
  )
}))

const { handleDproductsSyncRequest } = await import('./handler')

describe('GET /api/internal/suppliers/dinamik/dproducts-sync', () => {
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

  it('returns 401 when authorization header is wrong', async () => {
    const response = await handleDproductsSyncRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/dinamik/dproducts-sync',
        { headers: { authorization: 'Bearer wrong' } }
      )
    )
    expect(response.status).toBe(401)
  })
})
