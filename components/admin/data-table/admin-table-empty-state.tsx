import { cn } from '@/lib/utils'

interface AdminTableEmptyStateProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  className?: string
}

export function AdminTableEmptyState({
  title = 'Kayıt bulunamadı.',
  description = 'Farklı filtreler deneyebilirsiniz.',
  icon,
  className
}: AdminTableEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className
      )}
    >
      {icon ? <div className="text-muted-foreground/50">{icon}</div> : null}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
