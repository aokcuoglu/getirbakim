import { describe, expect, it } from 'bun:test'
import { Prisma } from '@prisma/client'
import {
  assertOfferFresh, assertPartnerOrderTransition, calculateBindingUnitPrice, cancellationOutcome,
  decodeOfferId, encodeOfferId, fingerprintOrderRequest, PartnerOrderError,
  resolvePartnerOrderPolicy, assertQuoteConfirmationCurrent,
  signQuoteConfirmation, verifyQuoteConfirmation
} from './order-contract'

const policy = resolvePartnerOrderPolicy(JSON.stringify({
  version: 'test-policy', targetMarginBps: 1250, minimumMarginBps: 500,
  offerMaxAgeSeconds: 120, reservationTtlSeconds: 60
}))

describe('partner order contract', () => {
  it('round-trips opaque offer identity and rejects malformed identity', () => {
    expect(decodeOfferId(encodeOfferId(BigInt('987654321')))).toBe(BigInt('987654321'))
    expect(decodeOfferId('987654321')).toBeNull()
  })

  it('fails closed when the server policy is missing or invalid', () => {
    expect(captureCode(() => resolvePartnerOrderPolicy(undefined))).toBe('POLICY_UNAVAILABLE')
    expect(captureCode(() => resolvePartnerOrderPolicy('{'))).toBe('POLICY_UNAVAILABLE')
  })

  it('derives exact net, VAT and gross amounts from revalidated cost', () => {
    const result = calculateBindingUnitPrice(new Prisma.Decimal('87.50'), policy)
    expect(result.net.add(result.vat).equals(result.gross)).toBe(true)
    expect(result.net.greaterThan(new Prisma.Decimal('87.50'))).toBe(true)
  })

  it('makes request replay comparison stable and payload-sensitive', () => {
    const first = fingerprintOrderRequest({ offer: 'offer_1', quantity: 1 })
    expect(fingerprintOrderRequest({ offer: 'offer_1', quantity: 1 })).toBe(first)
    expect(fingerprintOrderRequest({ offer: 'offer_1', quantity: 2 })).not.toBe(first)
  })

  it('signs an opaque exact quote confirmation and rejects tampering', () => {
    const confirmation = quoteConfirmation()
    const token = signQuoteConfirmation(confirmation, 's'.repeat(32))
    expect(verifyQuoteConfirmation(token, 's'.repeat(32))).toEqual(confirmation)
    expect(captureCode(() => verifyQuoteConfirmation(`${token.slice(0, -1)}x`, 's'.repeat(32)))).toBe('QUOTE_CHANGED')
    expect(captureCode(() => signQuoteConfirmation(confirmation, 'short'))).toBe('QUOTE_CONFIGURATION_UNAVAILABLE')
  })

  it('accepts only the exact unexpired partner, offer, price, policy and freshness snapshot', () => {
    const confirmation = quoteConfirmation()
    const current = {
      confirmation, partnerId: 'bakimx', selectedOfferId: 'offer_1', quantity: 2,
      unitNetKurus: 12500, policyVersion: 'stage2a-v1',
      offerPricedAt: new Date('2026-08-21T10:00:00.000Z'),
      offerLastSyncedAt: new Date('2026-08-21T10:01:00.000Z'),
      now: new Date('2026-08-21T10:05:00.000Z')
    }
    assertQuoteConfirmationCurrent(current)
    expect(captureCode(() => assertQuoteConfirmationCurrent({ ...current, unitNetKurus: 12501 }))).toBe('QUOTE_CHANGED')
    expect(captureCode(() => assertQuoteConfirmationCurrent({ ...current, policyVersion: 'stage2a-v2' }))).toBe('QUOTE_CHANGED')
    expect(captureCode(() => assertQuoteConfirmationCurrent({ ...current, offerLastSyncedAt: new Date('2026-08-21T10:02:00.000Z') }))).toBe('QUOTE_CHANGED')
    expect(captureCode(() => assertQuoteConfirmationCurrent({ ...current, now: new Date(confirmation.expiresAt) }))).toBe('QUOTE_EXPIRED')
  })

  it('rejects stale, inconsistent and future supplier timestamps', () => {
    const now = new Date('2026-08-21T12:00:00Z')
    assertOfferFresh(new Date('2026-08-21T11:59:30Z'), new Date('2026-08-21T11:59:50Z'), now, 60)
    expect(captureCode(() => assertOfferFresh(new Date('2026-08-21T11:58:00Z'), now, now, 60))).toBe('OFFER_EXPIRED')
    expect(captureCode(() => assertOfferFresh(new Date('2026-08-21T12:00:01Z'), new Date('2026-08-21T12:00:01Z'), now, 60))).toBe('OFFER_EXPIRED')
  })

  it('enforces canonical transition ordering', () => {
    assertPartnerOrderTransition('REQUESTED', 'CONFIRMED')
    assertPartnerOrderTransition('REQUESTED', 'REJECTED')
    assertPartnerOrderTransition('REQUESTED', 'RESERVATION_EXPIRED')
    assertPartnerOrderTransition('REQUESTED', 'CANCELLED')
    assertPartnerOrderTransition('CONFIRMED', 'SHIPPED')
    assertPartnerOrderTransition('CONFIRMED', 'CANCELLED')
    assertPartnerOrderTransition('SHIPPED', 'COMPLETED')
    expect(captureCode(() => assertPartnerOrderTransition('COMPLETED', 'REQUESTED'))).toBe('INVALID_TRANSITION')
    expect(captureCode(() => assertPartnerOrderTransition('CONFIRMED', 'REJECTED'))).toBe('INVALID_TRANSITION')
    expect(captureCode(() => assertPartnerOrderTransition('CANCELLED', 'SHIPPED'))).toBe('INVALID_TRANSITION')
  })

  it('turns confirmed cancellation into a request, not a state change', () => {
    expect(cancellationOutcome('REQUESTED')).toBe('CANCEL')
    expect(cancellationOutcome('CONFIRMED')).toBe('REQUEST')
    expect(cancellationOutcome('CANCELLED')).toBe('NOOP')
  })
})

function captureCode(fn: () => unknown): string | null {
  try { fn(); return null } catch (error) {
    return error instanceof PartnerOrderError ? error.code : 'unexpected'
  }
}

function quoteConfirmation() {
  return {
    version: 1 as const, partnerId: 'bakimx', selectedOfferId: 'offer_1', quantity: 2,
    unitNetKurus: 12500, policyVersion: 'stage2a-v1',
    offerPricedAt: '2026-08-21T10:00:00.000Z', offerLastSyncedAt: '2026-08-21T10:01:00.000Z',
    expiresAt: '2026-08-21T10:15:00.000Z'
  }
}
