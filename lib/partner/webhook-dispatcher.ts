import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { PARTNER_WEBHOOKS_ENV, resolvePartnerWebhooks } from './webhook-contract'
import { runPartnerWebhookDispatcher, type ClaimedPartnerOrderEvent } from './webhook-delivery'

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_MAX_ATTEMPTS = 8
const LEASE_SECONDS = 300

function boundedInt(raw: string | undefined, fallback: number, max: number) {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
}

export async function getPartnerOrderOperationsStats() {
  const now = new Date()
  const [pendingDelivery, overdueDelivery, deadLettered, overdueReservation, cancellationRequested] = await Promise.all([
    db.partner_order_events.count({ where: { delivered_at: null, dead_lettered_at: null } }),
    db.partner_order_events.count({ where: { delivered_at: null, dead_lettered_at: null, next_attempt_at: { lt: now } } }),
    db.partner_order_events.count({ where: { dead_lettered_at: { not: null } } }),
    db.partner_orders.count({ where: { status: 'REQUESTED', binding_expires_at: { lte: now } } }),
    db.partner_orders.count({ where: { status: 'CONFIRMED', cancellation_requested_at: { not: null } } })
  ])
  return { pendingDelivery, overdueDelivery, deadLettered, overdueReservation, cancellationRequested }
}

export async function dispatchPartnerOrderWebhooks() {
  const endpoints = resolvePartnerWebhooks(process.env[PARTNER_WEBHOOKS_ENV])
  const batchSize = boundedInt(process.env.PARTNER_WEBHOOK_BATCH_SIZE, DEFAULT_BATCH_SIZE, 100)
  const maxAttempts = boundedInt(process.env.PARTNER_WEBHOOK_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 25)
  return runPartnerWebhookDispatcher({
    now: () => new Date(),
    workerId: () => randomUUID(),
    endpoint: (partnerId) => endpoints.get(partnerId),
    claim: async ({ workerId, limit }) => {
      const claimed = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH due AS (
          SELECT "id" FROM "catalog"."partner_order_events"
          WHERE "delivered_at" IS NULL AND "dead_lettered_at" IS NULL
            AND "next_attempt_at" <= NOW()
            AND ("locked_at" IS NULL OR "locked_at" < NOW() - (${LEASE_SECONDS} * INTERVAL '1 second'))
          ORDER BY "next_attempt_at", "created_at" FOR UPDATE SKIP LOCKED LIMIT ${limit}
        )
        UPDATE "catalog"."partner_order_events" event
        SET "locked_at" = NOW(), "locked_by" = ${workerId}, "updated_at" = NOW()
        FROM due WHERE event."id" = due."id" RETURNING event."id"
      `)
      if (claimed.length === 0) return []
      const rows = await db.partner_order_events.findMany({
        where: { id: { in: claimed.map((row) => row.id) }, locked_by: workerId },
        orderBy: [{ next_attempt_at: 'asc' }, { created_at: 'asc' }]
      })
      return rows.map((event): ClaimedPartnerOrderEvent => ({
        id: event.id, partnerId: event.partner_id, orderId: event.order_id,
        contractVersion: event.contract_version, rawBody: event.raw_body,
        attemptCount: event.attempt_count, nextAttemptAt: event.next_attempt_at
      }))
    },
    post: async ({ endpoint, event, timestamp, signature }) => {
      const response = await fetch(endpoint.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json', 'webhook-id': event.id,
          'webhook-timestamp': timestamp, 'webhook-signature': signature,
          'webhook-version': event.contractVersion
        }, body: event.rawBody
      })
      return response.status
    },
    markDelivered: async ({ workerId, eventId, attempt, status, now }) => {
      await db.partner_order_events.updateMany({
        where: { id: eventId, locked_by: workerId },
        data: { attempt_count: attempt, delivered_at: now, locked_at: null, locked_by: null, last_http_status: status, last_error: null }
      })
    },
    markFailed: async ({ workerId, eventId, attempt, status, error, deadLetter, nextAttemptAt, now }) => {
      await db.partner_order_events.updateMany({
        where: { id: eventId, locked_by: workerId },
        data: {
          attempt_count: attempt, next_attempt_at: nextAttemptAt,
          dead_lettered_at: deadLetter ? now : null, locked_at: null, locked_by: null,
          last_http_status: status, last_error: error
        }
      })
    },
    log: (level, message, context) => console[level](message, context)
  }, { batchSize, maxAttempts, leaseMs: LEASE_SECONDS * 1000 })
}
