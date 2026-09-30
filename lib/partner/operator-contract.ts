import { PartnerOrderError, type PartnerOrderStatus } from './order-contract'

export const PARTNER_OPERATOR_ACTIONS = [
  'CONFIRM', 'REJECT', 'ACCEPT_CANCELLATION', 'DECLINE_CANCELLATION', 'SHIP', 'COMPLETE'
] as const
export type PartnerOperatorAction = typeof PARTNER_OPERATOR_ACTIONS[number]

export function resolveOperatorTransition(input: {
  status: PartnerOrderStatus
  action: PartnerOperatorAction
  cancellationRequested: boolean
  expired: boolean
  reason: string | null
}): { status: PartnerOrderStatus; reservation: 'COMMITTED' | 'RELEASED' | null } {
  const { status, action, cancellationRequested, expired, reason } = input
  if (status === 'REQUESTED' && expired) {
    throw new PartnerOrderError('INVALID_TRANSITION', 'Request reservation has expired.', 409)
  }
  if (!reason?.trim()) {
    throw new PartnerOrderError('INVALID_TRANSITION', 'A reason is required.', 409)
  }
  if (status === 'REQUESTED' && action === 'CONFIRM') return { status: 'CONFIRMED', reservation: 'COMMITTED' }
  if (status === 'REQUESTED' && action === 'REJECT') return { status: 'REJECTED', reservation: 'RELEASED' }
  if (status === 'CONFIRMED' && cancellationRequested && action === 'ACCEPT_CANCELLATION') return { status: 'CANCELLED', reservation: 'RELEASED' }
  if (status === 'CONFIRMED' && cancellationRequested && action === 'DECLINE_CANCELLATION') return { status: 'CONFIRMED', reservation: null }
  if (status === 'CONFIRMED' && !cancellationRequested && action === 'SHIP') return { status: 'SHIPPED', reservation: null }
  if (status === 'SHIPPED' && action === 'COMPLETE') return { status: 'COMPLETED', reservation: null }
  throw new PartnerOrderError('INVALID_TRANSITION', 'Order transition is not allowed.', 409)
}
