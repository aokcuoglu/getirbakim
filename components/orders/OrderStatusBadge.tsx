'use client'

import { cn } from '@/lib/utils'

function toneForStatus(status: string): { badge: string; dot: string } {
  if (status === 'PAID' || status === 'COMPLETED') {
    return {
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      dot: 'bg-emerald-500'
    }
  }
  if (status === 'PROCESSING' || status === 'SHIPPED') {
    return {
      badge: 'border-sky-200 bg-sky-50 text-sky-700',
      dot: 'bg-sky-500'
    }
  }
  if (status === 'PENDING_PAYMENT') {
    return {
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      dot: 'bg-amber-500'
    }
  }
  if (status === 'PAYMENT_FAILED' || status === 'CANCELLED' || status === 'REFUNDED') {
    return {
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      dot: 'bg-rose-500'
    }
  }

  return {
    badge: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground'
  }
}

export function OrderStatusBadge({
  status,
  className
}: {
  status: string
  className?: string
}) {
  const tone = toneForStatus(status)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        tone.badge,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      {status}
    </span>
  )
}
