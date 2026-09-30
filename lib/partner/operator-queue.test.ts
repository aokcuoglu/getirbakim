import { describe, expect, it } from 'bun:test'
import { mergeOperatorQueue, operatorQueuePlan } from './operator-queue'

describe('partner operator queue', () => {
  it('caps pending requests and cancellation decisions independently', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    const plan = operatorQueuePlan(now, 100)
    expect(plan.pending.where.status).toBe('REQUESTED')
    expect(plan.pending.where.binding_expires_at.gt).toEqual(now)
    expect(plan.pending.take).toBe(100)
    expect(plan.cancellations.where.status).toBe('CONFIRMED')
    expect(plan.cancellations.take).toBe(100)
    const cancellations = Array.from({ length: 100 }, (_, index) => ({ id: `cancel-${index}` }))
    const rows = mergeOperatorQueue([{ id: 'fresh-request' }], cancellations, [], [])
    expect(rows.length).toBe(101)
    expect(rows[0].id).toBe('fresh-request')
  })

  it('deduplicates recent rows without changing priority ordering', () => {
    expect(mergeOperatorQueue([{ id: 'pending' }], [{ id: 'cancel' }], [{ id: 'expired' }], [{ id: 'pending' }, { id: 'recent' }]).map(row => row.id))
      .toEqual(['pending', 'cancel', 'expired', 'recent'])
  })
})
