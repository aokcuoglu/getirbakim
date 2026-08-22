import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import {
  buildPartnerOrderEvent, classifyWebhookAttempt, isRetryableWebhookStatus,
  isWebhookLeaseClaimable, partnerOrderEventDedupeKey, resolvePartnerWebhooks,
  shouldExpirePartnerOrder, signPartnerWebhook, webhookRetryDelayMs
} from './webhook-contract'

const SECRET = 'test_partner_webhook_secret_0123456789'

describe('partner webhook contract', () => {
  it('freezes a full versioned order snapshot into immutable delivery bytes', () => {
    const order = {
      contractVersion: '1.0', id: 'order-1', status: 'CONFIRMED', version: 2,
      bindingPrice: {
        netKurus: 125_00, vatKurus: 25_00, grossKurus: 150_00, currency: 'TRY',
        policyVersion: 'margin-2026-08', expiresAt: '2026-08-21T21:00:00.000Z'
      },
      items: [{
        sourceProductId: '987654321', selectedOfferId: 'offer_kf12oi', quantity: 2,
        unitNetKurus: 62_50, unitVatKurus: 12_50, unitGrossKurus: 75_00
      }],
      cancellationRequested: false,
      createdAt: '2026-08-21T19:59:00.000Z', updatedAt: '2026-08-21T20:00:00.000Z'
    }
    const event = buildPartnerOrderEvent({
      eventId: 'event-1', occurredAt: new Date('2026-08-21T20:00:00.000Z'),
      partnerId: 'bakimx', order
    })
    const originalBytes = event.rawBody
    order.status = 'COMPLETED'
    order.version = 4
    expect(event.rawBody).toBe(originalBytes)
    expect(JSON.parse(event.rawBody)).toEqual({
      specVersion: '1.0', eventId: 'event-1', eventType: 'partner.order.updated',
      occurredAt: '2026-08-21T20:00:00.000Z', partnerId: 'bakimx',
      order: {
        contractVersion: '1.0', id: 'order-1', status: 'CONFIRMED', version: 2,
        bindingPrice: {
          netKurus: 125_00, vatKurus: 25_00, grossKurus: 150_00, currency: 'TRY',
          policyVersion: 'margin-2026-08', expiresAt: '2026-08-21T21:00:00.000Z'
        },
        items: [{
          sourceProductId: '987654321', selectedOfferId: 'offer_kf12oi', quantity: 2,
          unitNetKurus: 62_50, unitVatKurus: 12_50, unitGrossKurus: 75_00
        }],
        cancellationRequested: false,
        createdAt: '2026-08-21T19:59:00.000Z', updatedAt: '2026-08-21T20:00:00.000Z'
      }
    })
  })

  it('defines event uniqueness by order, monotonic version and event type', () => {
    const first = partnerOrderEventDedupeKey('order-1', 1)
    expect(partnerOrderEventDedupeKey('order-1', 1)).toBe(first)
    expect(partnerOrderEventDedupeKey('order-1', 2) === first).toBe(false)
    expect(partnerOrderEventDedupeKey('order-2', 1) === first).toBe(false)
  })

  it('signs the exact timestamp and raw body bytes', () => {
    const body = '{"eventId":"event-1","text":"ş"}'
    const expected = createHmac('sha256', SECRET).update(`1724263200.${body}`, 'utf8').digest('hex')
    expect(signPartnerWebhook(SECRET, '1724263200', body)).toBe(`v1=${expected}`)
    expect(signPartnerWebhook(SECRET, '1724263200', `${body} `)).not.toBe(`v1=${expected}`)
  })

  it('validates separate partner endpoint configuration', () => {
    const config = resolvePartnerWebhooks(JSON.stringify({
      bakimx: { url: 'https://bakimx.test/webhooks/orders', secret: SECRET }
    }), true)
    expect(config.get('bakimx')).toEqual({
      url: 'https://bakimx.test/webhooks/orders', secret: SECRET, enabled: true
    })
    expect(captureMessage(() => resolvePartnerWebhooks(JSON.stringify({
      bakimx: { url: 'http://bakimx.test/webhooks/orders', secret: SECRET }
    }), true))).toBe('Webhook URL for bakimx must use HTTPS.')
    expect(captureMessage(() => resolvePartnerWebhooks(undefined))).toBe('PARTNER_WEBHOOKS_JSON is not configured.')
  })

  it('classifies retryable and poison responses', () => {
    for (const status of [408, 425, 429, 500, 503]) expect(isRetryableWebhookStatus(status)).toBe(true)
    for (const status of [400, 401, 403, 404, 409, 422]) expect(isRetryableWebhookStatus(status)).toBe(false)
    expect(classifyWebhookAttempt({ status: 204, networkError: false, attempt: 1, maxAttempts: 8 })).toBe('DELIVERED')
    expect(classifyWebhookAttempt({ status: 503, networkError: false, attempt: 1, maxAttempts: 8 })).toBe('RETRY')
    expect(classifyWebhookAttempt({ status: null, networkError: true, attempt: 7, maxAttempts: 8 })).toBe('RETRY')
    expect(classifyWebhookAttempt({ status: 503, networkError: false, attempt: 8, maxAttempts: 8 })).toBe('DEAD_LETTER')
    expect(classifyWebhookAttempt({ status: 422, networkError: false, attempt: 1, maxAttempts: 8 })).toBe('DEAD_LETTER')
  })

  it('uses bounded exponential delay with stable jitter', () => {
    const first = webhookRetryDelayMs(1, 'event-a')
    expect(first).toBe(webhookRetryDelayMs(1, 'event-a'))
    expect(first >= 24_000).toBe(true)
    expect(first <= 36_000).toBe(true)
    expect(webhookRetryDelayMs(10, 'event-a') <= 4_320_000).toBe(true)
  })

  it('claims fresh work, excludes active leases and reclaims expired leases', () => {
    const now = new Date('2026-08-21T20:10:00.000Z')
    const base = {
      now, nextAttemptAt: new Date('2026-08-21T20:09:00.000Z'),
      lockedAt: null, deliveredAt: null, deadLetteredAt: null, leaseMs: 300_000
    }
    expect(isWebhookLeaseClaimable(base)).toBe(true)
    expect(isWebhookLeaseClaimable({ ...base, lockedAt: new Date('2026-08-21T20:09:59.000Z') })).toBe(false)
    expect(isWebhookLeaseClaimable({ ...base, lockedAt: new Date('2026-08-21T20:05:00.000Z') })).toBe(false)
    expect(isWebhookLeaseClaimable({ ...base, lockedAt: new Date('2026-08-21T20:04:59.999Z') })).toBe(true)
    expect(isWebhookLeaseClaimable({ ...base, nextAttemptAt: new Date('2026-08-21T20:11:00.000Z') })).toBe(false)
    expect(isWebhookLeaseClaimable({ ...base, deliveredAt: now })).toBe(false)
    expect(isWebhookLeaseClaimable({ ...base, deadLetteredAt: now })).toBe(false)
  })

  it('expires only due REQUESTED orders, including the exact deadline', () => {
    const now = new Date('2026-08-21T20:10:00.000Z')
    expect(shouldExpirePartnerOrder('REQUESTED', new Date('2026-08-21T20:09:59.000Z'), now)).toBe(true)
    expect(shouldExpirePartnerOrder('REQUESTED', now, now)).toBe(true)
    expect(shouldExpirePartnerOrder('REQUESTED', new Date('2026-08-21T20:10:01.000Z'), now)).toBe(false)
    for (const status of ['CONFIRMED', 'CANCELLED', 'REJECTED', 'SHIPPED', 'COMPLETED']) {
      expect(shouldExpirePartnerOrder(status, new Date('2026-08-21T20:00:00.000Z'), now)).toBe(false)
    }
  })
})

function captureMessage(fn: () => unknown): string | null {
  try { fn(); return null } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
