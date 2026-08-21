import { describe, expect, it } from 'bun:test'
import { isWebhookLeaseClaimable, type PartnerWebhookEndpoint } from './webhook-contract'
import {
  runPartnerWebhookDispatcher, type ClaimedPartnerOrderEvent,
  type PartnerWebhookDispatcherDependencies
} from './webhook-delivery'

const ENDPOINT: PartnerWebhookEndpoint = {
  url: 'https://bakimx.test/api/internal/procurement/webhook',
  secret: 'test_partner_webhook_secret_0123456789', enabled: true
}
const START = new Date('2026-08-22T00:00:00.000Z')

interface FakeRow extends ClaimedPartnerOrderEvent {
  lockedAt: Date | null
  lockedBy: string | null
  deliveredAt: Date | null
  deadLetteredAt: Date | null
  lastStatus: number | null
  lastError: string | null
}

function fakeDispatcher(input: { status?: number; error?: Error; attemptCount?: number; lockedAt?: Date | null }) {
  let clock = new Date(START)
  const logs: string[] = []
  const posts: Array<{ timestamp: string; signature: string; body: string }> = []
  const row: FakeRow = {
    id: 'event-1', partnerId: 'bakimx', orderId: 'order-1', contractVersion: '1.0',
    rawBody: '{"eventId":"event-1"}', attemptCount: input.attemptCount ?? 0,
    nextAttemptAt: new Date(START), lockedAt: input.lockedAt ?? null, lockedBy: input.lockedAt ? 'crashed-worker' : null,
    deliveredAt: null, deadLetteredAt: null, lastStatus: null, lastError: null
  }
  const dependencies: PartnerWebhookDispatcherDependencies = {
    now: () => new Date(clock), workerId: () => 'worker-1', endpoint: () => ENDPOINT,
    claim: async ({ workerId, limit, leaseMs, now }) => {
      if (limit < 1 || !isWebhookLeaseClaimable({
        now, nextAttemptAt: row.nextAttemptAt, lockedAt: row.lockedAt,
        deliveredAt: row.deliveredAt, deadLetteredAt: row.deadLetteredAt, leaseMs
      })) return []
      row.lockedAt = new Date(now); row.lockedBy = workerId
      return [{ ...row }]
    },
    post: async ({ event, timestamp, signature }) => {
      posts.push({ timestamp, signature, body: event.rawBody })
      if (input.error) throw input.error
      return input.status ?? 204
    },
    markDelivered: async ({ workerId, eventId, attempt, status, now }) => {
      if (eventId !== row.id || row.lockedBy !== workerId) return
      row.attemptCount = attempt; row.deliveredAt = new Date(now); row.lockedAt = null; row.lockedBy = null
      row.lastStatus = status; row.lastError = null
    },
    markFailed: async ({ workerId, eventId, attempt, status, error, deadLetter, nextAttemptAt, now }) => {
      if (eventId !== row.id || row.lockedBy !== workerId) return
      row.attemptCount = attempt; row.nextAttemptAt = new Date(nextAttemptAt)
      row.deadLetteredAt = deadLetter ? new Date(now) : null; row.lockedAt = null; row.lockedBy = null
      row.lastStatus = status; row.lastError = error
    },
    log: (_level, message) => logs.push(message)
  }
  return {
    row, logs, posts, dependencies,
    advance(ms: number) { clock = new Date(clock.getTime() + ms) }
  }
}

const OPTIONS = { batchSize: 25, maxAttempts: 3, leaseMs: 300_000 }

describe('partner webhook dispatcher orchestration', () => {
  it('persists successful 2xx delivery and releases the lease', async () => {
    const fake = fakeDispatcher({ status: 204 })
    expect(await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).toEqual({ claimed: 1, delivered: 1, retried: 0, deadLettered: 0 })
    expect(fake.row.attemptCount).toBe(1)
    expect(fake.row.deliveredAt?.toISOString()).toBe(START.toISOString())
    expect(fake.row.lockedBy).toBeNull()
    expect(fake.posts[0]?.signature.startsWith('v1=')).toBe(true)
    expect(fake.posts[0]?.body).toBe(fake.row.rawBody)
  })

  it('persists transient retry state and does not reclaim before next attempt', async () => {
    const fake = fakeDispatcher({ status: 503 })
    expect(await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).toEqual({ claimed: 1, delivered: 0, retried: 1, deadLettered: 0 })
    expect(fake.row.attemptCount).toBe(1)
    expect(fake.row.lastStatus).toBe(503)
    expect(fake.row.deadLetteredAt).toBeNull()
    expect(fake.row.nextAttemptAt > START).toBe(true)
    expect((await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).claimed).toBe(0)
  })

  it('dead-letters poison responses immediately', async () => {
    const fake = fakeDispatcher({ status: 422 })
    expect(await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).toEqual({ claimed: 1, delivered: 0, retried: 0, deadLettered: 1 })
    expect(fake.row.deadLetteredAt?.toISOString()).toBe(START.toISOString())
    expect(fake.row.lastError).toBe('Webhook returned HTTP 422.')
  })

  it('dead-letters retryable failures at the maximum attempt', async () => {
    const fake = fakeDispatcher({ error: new Error('timeout token=redacted'), attemptCount: 2 })
    expect(await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).toEqual({ claimed: 1, delivered: 0, retried: 0, deadLettered: 1 })
    expect(fake.row.attemptCount).toBe(3)
    expect(fake.row.lastStatus).toBeNull()
    expect(fake.row.deadLetteredAt?.toISOString()).toBe(START.toISOString())
  })

  it('excludes an active lease and reclaims it after lease expiry', async () => {
    const fake = fakeDispatcher({ status: 200, lockedAt: new Date(START.getTime() - 60_000) })
    expect((await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).claimed).toBe(0)
    fake.advance(300_001)
    expect(await runPartnerWebhookDispatcher(fake.dependencies, OPTIONS)).toEqual({ claimed: 1, delivered: 1, retried: 0, deadLettered: 0 })
    expect(fake.row.lockedBy).toBeNull()
    expect(fake.row.deliveredAt == null).toBe(false)
  })
})
