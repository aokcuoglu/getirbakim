import { cn } from '@/lib/utils'

type AdminKpiTone = 'default' | 'warning' | 'danger' | 'info'

interface AdminKpiCardProps {
  label: string
  value: number | string
  tone?: AdminKpiTone
  icon?: React.ReactNode
}

const toneStyles: Record<
  AdminKpiTone,
  { card: string; label: string; value: string; icon: string }
> = {
  default: {
    card: 'border-border bg-card',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    icon: 'bg-muted text-muted-foreground'
  },
  warning: {
    card: 'border-border bg-secondary/30',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    icon: 'bg-secondary text-secondary-foreground'
  },
  danger: {
    card: 'border-destructive/20 bg-destructive/5',
    label: 'text-muted-foreground',
    value: 'text-destructive',
    icon: 'bg-destructive/10 text-destructive'
  },
  info: {
    card: 'border-border bg-muted/40',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    icon: 'bg-muted text-muted-foreground'
  }
}

export function AdminKpiCard({
  label,
  value,
  tone = 'default',
  icon
}: AdminKpiCardProps) {
  const styles = toneStyles[tone]

  return (
    <div className={cn('rounded-lg border p-3', styles.card)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-[11px] font-medium uppercase tracking-wide', styles.label)}>
          {label}
        </p>
        {icon ? (
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              styles.icon
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      <p className={cn('mt-1 text-lg font-semibold tracking-tight', styles.value)}>
        {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
      </p>
    </div>
  )
}

interface AdminKpiGridProps {
  children: React.ReactNode
  className?: string
}

export function AdminKpiGrid({ children, className }: AdminKpiGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  )
}
