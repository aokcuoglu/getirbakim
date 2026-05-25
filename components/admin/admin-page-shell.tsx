import type { ReactNode } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link } from '@/lib/navigation'
import type { AdminBreadcrumbItem } from '@/lib/admin/breadcrumbs'

export type { AdminBreadcrumbItem }

type AdminPageWidth = 'wide' | 'default' | 'narrow'

const widthClassMap: Record<AdminPageWidth, string> = {
  wide: 'max-w-[1400px]',
  default: 'max-w-[1200px]',
  narrow: 'max-w-[900px]'
}

interface AdminPageShellProps {
  children: ReactNode
  className?: string
  width?: AdminPageWidth
}

interface AdminBreadcrumbsProps {
  items: AdminBreadcrumbItem[]
  className?: string
}

interface AdminPageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: AdminBreadcrumbItem[]
  actions?: ReactNode
}

interface AdminSurfaceProps {
  children: ReactNode
  className?: string
}

export function AdminPageShell({
  children,
  className,
  width = 'wide'
}: AdminPageShellProps) {
  return (
    <section
      className={cn(
        'mx-auto w-full space-y-6',
        widthClassMap[width],
        className
      )}
    >
      {children}
    </section>
  )
}

export function AdminBreadcrumbs({ items, className }: AdminBreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex flex-wrap items-center gap-1.5 text-sm', className)}
    >
      <Link
        href="/admin"
        className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Genel Bakış"
      >
        <Home size={16} strokeWidth={2} />
      </Link>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        const isLink = Boolean(item.href) && !isLast

        return (
          <div key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            <ChevronRight
              aria-hidden="true"
              className="h-3.5 w-3.5 text-muted-foreground/60"
            />
            {isLink ? (
              <Link
                href={item.href!}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  isLast ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
                {...(isLast ? { 'aria-current': 'page' as const } : {})}
              >
                {item.label}
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function AdminPageHeader({
  title,
  description,
  breadcrumbs,
  actions
}: AdminPageHeaderProps) {
  return (
    <header className="space-y-1">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <AdminBreadcrumbs items={breadcrumbs} />
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="admin-header-actions flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  )
}

export function AdminSurface({ children, className }: AdminSurfaceProps) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className
      )}
    >
      {children}
    </section>
  )
}
