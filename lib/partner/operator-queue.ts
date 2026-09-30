/** Independent caps keep a large cancellation backlog from hiding live requests. */
export function operatorQueuePlan(now: Date, take: number) {
  const bounded = Math.min(Math.max(take, 1), 100)
  return {
    pending: {
      where: { status: 'REQUESTED', binding_expires_at: { gt: now } },
      orderBy: { binding_expires_at: 'asc' }, take: bounded
    },
    cancellations: {
      where: { status: 'CONFIRMED', cancellation_requested_at: { not: null } },
      orderBy: { cancellation_requested_at: 'asc' }, take: bounded
    },
    overdue: {
      where: { status: 'REQUESTED', binding_expires_at: { lte: now } },
      orderBy: { binding_expires_at: 'asc' }, take: 20
    },
    recent: { orderBy: { created_at: 'desc' }, take: bounded }
  } as const
}

export function mergeOperatorQueue<T extends { id: string }>(
  pending: T[], cancellations: T[], overdue: T[], recent: T[]
): T[] {
  return [...new Map([...pending, ...cancellations, ...overdue, ...recent].map((row) => [row.id, row])).values()]
}
