'use client'

import { cn } from '@/lib/utils'

function toneForStatus(status: string): string {
  if (status === 'PAID' || status === 'COMPLETED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (status === 'PROCESSING' || status === 'SHIPPED') {
    return 'border-sky-200 bg-sky-50 text-sky-700'
  }
  if (status === 'PENDING_PAYMENT') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  if (status === 'PAYMENT_FAILED' || status === 'CANCELLED' || status === 'REFUNDED') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
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
