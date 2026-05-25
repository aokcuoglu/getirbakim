import { cn } from '@/lib/utils'

interface AdminTableHeadProps {
  children: React.ReactNode
  className?: string
}

export function adminTableHeadClassName(className?: string) {
  return cn(
    'text-xs font-medium uppercase tracking-wide text-muted-foreground',
    className
  )
}

export function adminTableHeaderRowClassName(className?: string) {
  return cn(
    'border-b border-border bg-muted/40 hover:bg-muted/40',
    className
  )
}

export function adminTableCellClassName(className?: string) {
  return cn('px-3 py-2.5 align-middle', className)
}

export function AdminTableHead({ children, className }: AdminTableHeadProps) {
  return <span className={adminTableHeadClassName(className)}>{children}</span>
}
