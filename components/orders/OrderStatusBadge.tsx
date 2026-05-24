'use client'

import { cn } from '@/lib/utils'

function toneForStatus(status: string): string {
  if (status === 'PAID' || status === 'COMPLETED') {
    return 'border-success/20 bg-success/10 text-success'
  }
  if (status === 'PROCESSING' || status === 'SHIPPED') {
    return 'border-border bg-accent text-primary'
  }
  if (status === 'PENDING_PAYMENT') {
    return 'border-warning/20 bg-warning/10 text-warning'
  }
  if (status === 'PAYMENT_FAILED' || status === 'CANCELLED' || status === 'REFUNDED') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  return 'border-border bg-muted text-foreground'
}

export function OrderStatusBadge({
  status,
  className
}: {
  status: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
        toneForStatus(status),
        className
      )}
    >
      {status}
    </span>
  )
}
