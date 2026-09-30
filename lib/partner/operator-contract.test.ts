import { describe, expect, it } from 'bun:test'
import { resolveOperatorTransition } from './operator-contract'

describe('partner operator transitions', () => {
  function fails(action: () => unknown) {
    try { action(); return false } catch { return true }
  }
  const request = { status: 'REQUESTED' as const, cancellationRequested: false, expired: false, reason: 'Operatör kontrolü' }
  it('commits only live requests and releases rejected reservations', () => {
    expect(resolveOperatorTransition({ ...request, action: 'CONFIRM' })).toEqual({ status: 'CONFIRMED', reservation: 'COMMITTED' })
    expect(resolveOperatorTransition({ ...request, action: 'REJECT', reason: 'Supplier unavailable' })).toEqual({ status: 'REJECTED', reservation: 'RELEASED' })
    expect(fails(() => resolveOperatorTransition({ ...request, action: 'CONFIRM', expired: true }))).toBe(true)
    expect(fails(() => resolveOperatorTransition({ ...request, action: 'REJECT', reason: null }))).toBe(true)
    expect(fails(() => resolveOperatorTransition({ ...request, action: 'CONFIRM', reason: null }))).toBe(true)
  })
  it('requires explicit cancellation handling before shipping', () => {
    const confirmed = { status: 'CONFIRMED' as const, cancellationRequested: true, expired: false, reason: 'Atölye talebi' }
    expect(resolveOperatorTransition({ ...confirmed, action: 'ACCEPT_CANCELLATION' }).reservation).toBe('RELEASED')
    expect(resolveOperatorTransition({ ...confirmed, action: 'DECLINE_CANCELLATION' }).status).toBe('CONFIRMED')
    expect(fails(() => resolveOperatorTransition({ ...confirmed, action: 'SHIP' }))).toBe(true)
    expect(resolveOperatorTransition({ ...confirmed, cancellationRequested: false, action: 'SHIP' }).status).toBe('SHIPPED')
    expect(resolveOperatorTransition({ ...confirmed, status: 'SHIPPED', action: 'COMPLETE' }).status).toBe('COMPLETED')
  })
})
