import { createHmac } from 'node:crypto'
import { z } from 'zod'

export const PARTNER_WEBHOOKS_ENV = 'PARTNER_WEBHOOKS_JSON'

const endpointSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(32),
  enabled: z.boolean().optional().default(true)
}).strict()

export interface PartnerWebhookEndpoint {
  url: string
  secret: string
  enabled: boolean
}

export const PARTNER_ORDER_EVENT_TYPE = 'partner.order.updated'
export const PARTNER_ORDER_EVENT_VERSION = '1.0'

export function buildPartnerOrderEvent(input: {
  eventId: string
  occurredAt: Date
  partnerId: string
  order: unknown
}) {
  const rawBody = JSON.stringify({
    specVersion: PARTNER_ORDER_EVENT_VERSION,
    eventId: input.eventId,
    eventType: PARTNER_ORDER_EVENT_TYPE,
    occurredAt: input.occurredAt.toISOString(),
    partnerId: input.partnerId,
    order: input.order
  })
  return {
    id: input.eventId,
    eventType: PARTNER_ORDER_EVENT_TYPE,
    contractVersion: PARTNER_ORDER_EVENT_VERSION,
    rawBody
  }
}

export function partnerOrderEventDedupeKey(orderId: string, orderVersion: number): string {
  return `${orderId}:${orderVersion}:${PARTNER_ORDER_EVENT_TYPE}`
}

export function resolvePartnerWebhooks(
  raw: string | null | undefined,
  production = process.env.NODE_ENV === 'production'
): Map<string, PartnerWebhookEndpoint> {
  if (!raw) throw new Error(`${PARTNER_WEBHOOKS_ENV} is not configured.`)
  const parsed = z.record(z.string().trim().min(1).max(64), endpointSchema).parse(JSON.parse(raw))
  const result = new Map<string, PartnerWebhookEndpoint>()
  for (const [partnerId, endpoint] of Object.entries(parsed)) {
    const url = new URL(endpoint.url)
    if (production && url.protocol !== 'https:') {
      throw new Error(`Webhook URL for ${partnerId} must use HTTPS.`)
    }
    if (url.username || url.password) throw new Error(`Webhook URL for ${partnerId} must not contain credentials.`)
    result.set(partnerId, endpoint)
  }
  return result
}

export function signPartnerWebhook(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`
}

export function isRetryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export type WebhookAttemptOutcome = 'DELIVERED' | 'RETRY' | 'DEAD_LETTER'

export function classifyWebhookAttempt(input: {
  status: number | null
  networkError: boolean
  attempt: number
  maxAttempts: number
}): WebhookAttemptOutcome {
  if (!input.networkError && input.status != null && input.status >= 200 && input.status < 300) return 'DELIVERED'
  const retryable = input.networkError || (input.status != null && isRetryableWebhookStatus(input.status))
  return retryable && input.attempt < input.maxAttempts ? 'RETRY' : 'DEAD_LETTER'
}

export function isWebhookLeaseClaimable(input: {
  now: Date
  nextAttemptAt: Date
  lockedAt: Date | null
  deliveredAt: Date | null
  deadLetteredAt: Date | null
  leaseMs: number
}): boolean {
  if (input.deliveredAt || input.deadLetteredAt || input.nextAttemptAt > input.now) return false
  return input.lockedAt == null || input.lockedAt.getTime() < input.now.getTime() - input.leaseMs
}

export function shouldExpirePartnerOrder(status: string, bindingExpiresAt: Date, now: Date): boolean {
  return status === 'REQUESTED' && bindingExpiresAt <= now
}

export function webhookRetryDelayMs(attempt: number, eventId: string): number {
  const cappedAttempt = Math.min(Math.max(attempt, 1), 10)
  const base = Math.min(30_000 * (2 ** (cappedAttempt - 1)), 3_600_000)
  let hash = 0
  for (const char of eventId) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return Math.round(base * (0.8 + (hash % 401) / 1000))
}
