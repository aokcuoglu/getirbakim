import { describe, expect, it } from 'bun:test'
import { Prisma } from '@prisma/client'
import {
  assertOfferFresh, assertPartnerOrderTransition, calculateBindingUnitPrice, cancellationOutcome,
  decodeOfferId, encodeOfferId, fingerprintOrderRequest, PartnerOrderError,
  resolvePartnerOrderPolicy
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

  it('rejects stale, inconsistent and future supplier timestamps', () => {
    const now = new Date('2026-08-21T12:00:00Z')
    assertOfferFresh(new Date('2026-08-21T11:59:30Z'), new Date('2026-08-21T11:59:50Z'), now, 60)
    expect(captureCode(() => assertOfferFresh(new Date('2026-08-21T11:58:00Z'), now, now, 60))).toBe('OFFER_EXPIRED')
    expect(captureCode(() => assertOfferFresh(new Date('2026-08-21T12:00:01Z'), new Date('2026-08-21T12:00:01Z'), now, 60))).toBe('OFFER_EXPIRED')
  })

  it('enforces canonical transition ordering', () => {
    assertPartnerOrderTransition('REQUESTED', 'CONFIRMED')
    expect(captureCode(() => assertPartnerOrderTransition('COMPLETED', 'REQUESTED'))).toBe('INVALID_TRANSITION')
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
