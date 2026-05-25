import { cn } from '@/lib/utils'

type AdminKpiTone = 'default' | 'warning' | 'danger' | 'success' | 'info'

interface AdminKpiCardProps {
  label: string
  value: number | string
  tone?: AdminKpiTone
  subtitle?: string
  /** @deprecated Icons removed in favor of color bars */
  icon?: React.ReactNode
}

const toneStyles: Record<
  AdminKpiTone,
  { bar: string; value: string }
> = {
  default: {
    bar: 'bg-primary',
    value: 'text-foreground'
  },
  warning: {
    bar: 'bg-warning',
    value: 'text-foreground'
  },
  danger: {
    bar: 'bg-destructive',
    value: 'text-foreground'
  },
  success: {
    bar: 'bg-success',
    value: 'text-foreground'
  },
  info: {
    bar: 'bg-muted-foreground',
    value: 'text-foreground'
  }
}

export function AdminKpiCard({
  label,
  value,
  tone = 'default',
  subtitle
}: AdminKpiCardProps) {
  const styles = toneStyles[tone]

  const formattedValue =
    typeof value === 'number' ? value.toLocaleString('tr-TR') : value

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-end gap-2">
        <p className={cn('text-lg font-semibold tracking-tight', styles.value)}>
          {formattedValue}
        </p>
        <div className={cn('mb-1 h-1 w-8 shrink-0 rounded-sm', styles.bar)} />
      </div>
      {subtitle ? (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
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
        'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  )
}
