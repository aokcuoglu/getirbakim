import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import { handleSetaSyncRequest } from './handler'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

describe('GET /api/internal/suppliers/seta/sync', () => {
  let calls: Array<{
    triggerType: 'SCHEDULED'
    mode?: 'full' | 'delta'
    brand?: string
    limitProducts?: number
  }> = []

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    calls = []
  })

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET == null) {
      delete process.env.CRON_SECRET
      return
    }

    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
  })

  it('returns 401 when authorization header is missing', async () => {
    const response = await handleSetaSyncRequest(
      new NextRequest('http://localhost/api/internal/suppliers/seta/sync'),
      async (input) => {
        calls.push(input)
        return {
          runId: 42,
          status: 'SUCCESS',
          brandCount: 2,
          totalCount: 120,
          successCount: 115,
          failedCount: 5,
          errorCount: 2,
          mappingMissCount: 44,
          approvedMappingCount: 71,
          offerCount: 71,
          policyUpdatedCount: 40
        }
      }
    )

    expect(response.status).toBe(401)
    expect(calls.length).toBe(0)
  })

  it('runs sync and passes parsed query params', async () => {
    const response = await handleSetaSyncRequest(
      new NextRequest(
        'http://localhost/api/internal/suppliers/seta/sync?mode=delta&brand=BOSCH&limitProducts=25',
        {
          headers: {
            authorization: 'Bearer test-secret'
          }
        }
      ),
      async (input) => {
        calls.push(input)
        return {
          runId: 99,
          status: 'PARTIAL_SUCCESS',
          brandCount: 1,
          totalCount: 25,
          successCount: 24,
          failedCount: 1,
          errorCount: 1,
          mappingMissCount: 7,
          approvedMappingCount: 17,
          offerCount: 17,
          policyUpdatedCount: 9
        }
      }
    )

    expect(response.status).toBe(200)
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({
      triggerType: 'SCHEDULED',
      mode: 'delta',
      brand: 'BOSCH',
      limitProducts: 25
    })
  })
})
