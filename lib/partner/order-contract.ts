import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

export const PARTNER_ORDER_POLICY_ENV = 'PARTNER_ORDER_POLICY_JSON'
export const PARTNER_QUOTE_SIGNING_SECRET_ENV = 'PARTNER_QUOTE_SIGNING_SECRET'
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
      'PRICE_CHANGED' | 'QUOTE_CHANGED' | 'QUOTE_EXPIRED' | 'QUOTE_CONFIGURATION_UNAVAILABLE' |
      'IDEMPOTENCY_CONFLICT' | 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION',
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>
  ) { super(message) }
}

const quoteConfirmationSchema = z.object({
  version: z.literal(1), partnerId: z.string().trim().min(1).max(64),
  selectedOfferId: z.string().min(1).max(64), quantity: z.number().int().positive().max(100),
  unitNetKurus: z.number().int().positive(), policyVersion: z.string().trim().min(1).max(64),
  offerPricedAt: z.string().datetime(), offerLastSyncedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict()
export type QuoteConfirmation = z.infer<typeof quoteConfirmationSchema>

function quoteSigningSecret(raw: string | null | undefined): string {
  const secret = raw?.trim()
  if (!secret || secret.length < 32) {
    throw new PartnerOrderError('QUOTE_CONFIGURATION_UNAVAILABLE', 'Partner quote confirmation is unavailable.', 503)
  }
  return secret
}

export function signQuoteConfirmation(confirmation: QuoteConfirmation, rawSecret: string | null | undefined): string {
  const payload = Buffer.from(JSON.stringify(quoteConfirmationSchema.parse(confirmation)), 'utf8').toString('base64url')
  const signature = createHmac('sha256', quoteSigningSecret(rawSecret)).update(payload, 'ascii').digest('base64url')
  return `${payload}.${signature}`
}

export function verifyQuoteConfirmation(token: string, rawSecret: string | null | undefined): QuoteConfirmation {
  const [payload, suppliedSignature, extra] = token.split('.')
  if (!payload || !suppliedSignature || extra) throw new PartnerOrderError('QUOTE_CHANGED', 'Binding quote must be confirmed again.', 409)
  const expected = createHmac('sha256', quoteSigningSecret(rawSecret)).update(payload, 'ascii').digest()
  const supplied = Buffer.from(suppliedSignature, 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PartnerOrderError('QUOTE_CHANGED', 'Binding quote must be confirmed again.', 409)
  }
  try { return quoteConfirmationSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))) }
  catch { throw new PartnerOrderError('QUOTE_CHANGED', 'Binding quote must be confirmed again.', 409) }
}

export function assertQuoteConfirmationCurrent(input: {
  confirmation: QuoteConfirmation; partnerId: string; selectedOfferId: string; quantity: number
  unitNetKurus: number; policyVersion: string; offerPricedAt: Date; offerLastSyncedAt: Date; now: Date
}) {
  const { confirmation } = input
  if (new Date(confirmation.expiresAt).getTime() <= input.now.getTime()) {
    throw new PartnerOrderError('QUOTE_EXPIRED', 'Binding quote expired and must be confirmed again.', 409)
  }
  if (confirmation.partnerId !== input.partnerId || confirmation.selectedOfferId !== input.selectedOfferId ||
      confirmation.quantity !== input.quantity || confirmation.unitNetKurus !== input.unitNetKurus ||
      confirmation.policyVersion !== input.policyVersion ||
      confirmation.offerPricedAt !== input.offerPricedAt.toISOString() ||
      confirmation.offerLastSyncedAt !== input.offerLastSyncedAt.toISOString()) {
    throw new PartnerOrderError('QUOTE_CHANGED', 'Binding quote changed and must be confirmed again.', 409)
  }
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
