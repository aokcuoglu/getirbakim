import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import { handleDinamikScheduledSyncRequest } from './handler'

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

describe('GET /api/internal/suppliers/dinamik/sync', () => {
  let calls: Array<{ triggerType: string }> = []

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

  it('returns 401 when authorization header is missing or invalid', async () => {
    const response = await handleDinamikScheduledSyncRequest(
      new NextRequest('http://localhost/api/internal/suppliers/dinamik/sync'),
      async (input) => {
        calls.push(input)
        return {
          runId: 42,
          providerId: 9,
          status: 'SUCCESS',
          totalCount: 120,
          successCount: 118,
          failedCount: 2,
          mappingMissCount: 7,
          brands: [],
          errors: []
        }
      }
    )

    expect(response.status).toBe(401)
    expect(calls.length).toBe(0)
  })

  it('runs scheduled sync when authorization header matches', async () => {
    const response = await handleDinamikScheduledSyncRequest(
      new NextRequest('http://localhost/api/internal/suppliers/dinamik/sync', {
        headers: {
          authorization: 'Bearer test-secret'
        }
      }),
      async (input) => {
        calls.push(input)
        return {
          runId: 42,
          providerId: 9,
          status: 'SUCCESS',
          totalCount: 120,
          successCount: 118,
          failedCount: 2,
          mappingMissCount: 7,
          brands: [],
          errors: []
        }
      }
    )

    expect(response.status).toBe(200)
    expect(calls.length).toBe(1)
    expect(calls[0]?.triggerType).toBe('SCHEDULED')

    const body = await response.json()
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        success: true,
        status: 'SUCCESS',
        runId: 42,
        totalCount: 120,
        successCount: 118,
        failedCount: 2,
        mappingMissCount: 7
      })
    )
  })
})
