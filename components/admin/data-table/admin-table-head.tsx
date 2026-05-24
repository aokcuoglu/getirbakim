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

export function AdminTableHead({ children, className }: AdminTableHeadProps) {
  return <span className={adminTableHeadClassName(className)}>{children}</span>
}
