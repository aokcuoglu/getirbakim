import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

export const PARTNER_ORDER_POLICY_ENV = 'PARTNER_ORDER_POLICY_JSON'
export const PARTNER_ORDER_STATUSES = [
  'REQUESTED', 'CONFIRMED', 'REJECTED', 'RESERVATION_EXPIRED',
  'CANCELLED', 'SHIPPED', 'COMPLETED'
] as const
export type PartnerOrderStatus = (typeof PARTNER_ORDER_STATUSES)[number]

const policySchema = z.object({
  version: z.string().trim().min(1).max(64),
  targetMarginBps: z.number().int().min(0).max(9500),
  minimumMarginBps: z.number().int().min(0).max(9500),
  offerMaxAgeSeconds: z.number().int().positive().max(86400),
  reservationTtlSeconds: z.number().int().positive().max(86400)
}).refine((value) => value.targetMarginBps >= value.minimumMarginBps)

export type PartnerOrderPolicy = z.infer<typeof policySchema>

export class PartnerOrderError extends Error {
  constructor(
    public readonly code: 'POLICY_UNAVAILABLE' | 'OFFER_UNAVAILABLE' | 'OFFER_EXPIRED' |
      'PRICE_CHANGED' | 'IDEMPOTENCY_CONFLICT' | 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION',
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>
  ) { super(message) }
}

export function resolvePartnerOrderPolicy(raw: string | null | undefined): PartnerOrderPolicy {
  if (!raw) throw new PartnerOrderError('POLICY_UNAVAILABLE', 'Partner order policy is unavailable.', 503)
  try {
    return policySchema.parse(JSON.parse(raw))
  } catch {
    throw new PartnerOrderError('POLICY_UNAVAILABLE', 'Partner order policy is unavailable.', 503)
  }
}

export function encodeOfferId(id: bigint): string { return `offer_${id.toString(36)}` }
export function decodeOfferId(value: string): bigint | null {
  if (!/^offer_[0-9a-z]+$/.test(value)) return null
  let result = BigInt(0)
  for (const char of value.slice(6)) {
    const digit = BigInt(parseInt(char, 36))
    result = result * BigInt(36) + digit
  }
  return result > BigInt(0) ? result : null
}

export function fingerprintOrderRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function calculateBindingUnitPrice(netCost: Prisma.Decimal, policy: PartnerOrderPolicy) {
  if (!netCost.isFinite() || netCost.lessThanOrEqualTo(0)) {
    throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer cannot be priced.', 409)
  }
  const divisor = new Prisma.Decimal(10000 - policy.targetMarginBps)
  const net = netCost.mul(10000).div(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL)
  const vat = net.mul(20).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  return { net, vat, gross: net.add(vat) }
}

export function assertOfferFresh(
  pricedAt: Date,
  lastSyncedAt: Date,
  now: Date,
  maxAgeSeconds: number
) {
  const pricedMs = pricedAt.getTime()
  const syncedMs = lastSyncedAt.getTime()
  const nowMs = now.getTime()
  if (pricedMs > nowMs || syncedMs > nowMs || syncedMs < pricedMs || nowMs - pricedMs > maxAgeSeconds * 1000) {
    throw new PartnerOrderError('OFFER_EXPIRED', 'Selected offer is no longer fresh.', 409)
  }
}

const allowedTransitions: Record<PartnerOrderStatus, readonly PartnerOrderStatus[]> = {
  REQUESTED: ['CONFIRMED', 'REJECTED', 'RESERVATION_EXPIRED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  REJECTED: [], RESERVATION_EXPIRED: [], CANCELLED: [],
  SHIPPED: ['COMPLETED'], COMPLETED: []
}

export function assertPartnerOrderTransition(from: PartnerOrderStatus, to: PartnerOrderStatus) {
  if (!allowedTransitions[from].includes(to)) {
    throw new PartnerOrderError('INVALID_TRANSITION', 'Order transition is not allowed.', 409)
  }
}

export function cancellationOutcome(status: PartnerOrderStatus): 'CANCEL' | 'REQUEST' | 'NOOP' {
  if (status === 'REQUESTED') return 'CANCEL'
  if (status === 'CONFIRMED') return 'REQUEST'
  if (status === 'CANCELLED') return 'NOOP'
  throw new PartnerOrderError('INVALID_TRANSITION', 'Order cannot be cancelled.', 409)
}
