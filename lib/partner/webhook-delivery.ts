import {
  classifyWebhookAttempt, signPartnerWebhook, webhookRetryDelayMs,
  type PartnerWebhookEndpoint
} from './webhook-contract'

export interface ClaimedPartnerOrderEvent {
  id: string
  partnerId: string
  orderId: string
  contractVersion: string
  rawBody: string
  attemptCount: number
  nextAttemptAt: Date
}

export interface PartnerWebhookDispatcherDependencies {
  claim(input: { workerId: string; limit: number; leaseMs: number; now: Date }): Promise<ClaimedPartnerOrderEvent[]>
  endpoint(partnerId: string): PartnerWebhookEndpoint | undefined
  post(input: { endpoint: PartnerWebhookEndpoint; event: ClaimedPartnerOrderEvent; timestamp: string; signature: string }): Promise<number>
  markDelivered(input: { workerId: string; eventId: string; attempt: number; status: number; now: Date }): Promise<void>
  markFailed(input: {
    workerId: string; eventId: string; attempt: number; status: number | null;
    error: string; deadLetter: boolean; nextAttemptAt: Date; now: Date
  }): Promise<void>
  log(level: 'warn' | 'error', message: string, context: Record<string, unknown>): void
  now(): Date
  workerId(): string
}

export interface PartnerWebhookDispatcherOptions {
  batchSize: number
  maxAttempts: number
  leaseMs: number
}

export interface PartnerWebhookDispatchResult {
  claimed: number
  delivered: number
  retried: number
  deadLettered: number
}

function safeError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message.slice(0, 500)
}

/** The production dispatcher and behavioral tests share this exact state machine. */
export async function runPartnerWebhookDispatcher(
  dependencies: PartnerWebhookDispatcherDependencies,
  options: PartnerWebhookDispatcherOptions
): Promise<PartnerWebhookDispatchResult> {
  const workerId = dependencies.workerId()
  const claimedAt = dependencies.now()
  const events = await dependencies.claim({ workerId, limit: options.batchSize, leaseMs: options.leaseMs, now: claimedAt })
  const result: PartnerWebhookDispatchResult = { claimed: events.length, delivered: 0, retried: 0, deadLettered: 0 }

  for (const event of events) {
    const endpoint = dependencies.endpoint(event.partnerId)
    const attempt = event.attemptCount + 1
    let status: number | null = null
    let networkError = false
    let errorMessage: string | null = null
    try {
      if (!endpoint?.enabled) throw new Error(`Webhook endpoint is unavailable for partner ${event.partnerId}.`)
      const timestamp = Math.floor(dependencies.now().getTime() / 1000).toString()
      status = await dependencies.post({
        endpoint, event, timestamp,
        signature: signPartnerWebhook(endpoint.secret, timestamp, event.rawBody)
      })
      if (classifyWebhookAttempt({ status, networkError: false, attempt, maxAttempts: options.maxAttempts }) === 'DELIVERED') {
        await dependencies.markDelivered({ workerId, eventId: event.id, attempt, status, now: dependencies.now() })
        result.delivered += 1
        continue
      }
      errorMessage = `Webhook returned HTTP ${status}.`
    } catch (error) {
      networkError = true
      errorMessage = safeError(error)
    }

    const deadLetter = classifyWebhookAttempt({ status, networkError, attempt, maxAttempts: options.maxAttempts }) === 'DEAD_LETTER'
    const now = dependencies.now()
    const nextAttemptAt = deadLetter ? event.nextAttemptAt : new Date(now.getTime() + webhookRetryDelayMs(attempt, event.id))
    await dependencies.markFailed({
      workerId, eventId: event.id, attempt, status, error: errorMessage ?? 'Webhook delivery failed.',
      deadLetter, nextAttemptAt, now
    })
    const context = { eventId: event.id, partnerId: event.partnerId, orderId: event.orderId, attempt, status }
    dependencies.log(deadLetter ? 'error' : 'warn', deadLetter ? '[partner-webhook:dead-letter]' : '[partner-webhook:retry]', context)
    if (deadLetter) result.deadLettered += 1
    else result.retried += 1
  }
  return result
}
