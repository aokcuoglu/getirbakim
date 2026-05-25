import { cn } from '@/lib/utils'

export type ReferenceOrderStatus =
  | 'Accepted'
  | 'Pending'
  | 'Completed'
  | 'Rejected'

const statusStyles: Record<
  ReferenceOrderStatus,
  { badge: string }
> = {
  Accepted: {
    badge: 'border-border bg-secondary text-secondary-foreground'
  },
  Pending: {
    badge: 'border-border bg-muted text-muted-foreground'
  },
  Completed: {
    badge: 'border-foreground/20 bg-foreground text-background'
  },
  Rejected: {
    badge: 'border-border bg-muted text-muted-foreground line-through'
  }
}

export function OrderReferenceStatusBadge({
  status,
  className
}: {
  status: ReferenceOrderStatus
  className?: string
}) {
  const tone = statusStyles[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium',
        tone.badge,
        className
      )}
    >
      {status}
    </span>
  )
}
