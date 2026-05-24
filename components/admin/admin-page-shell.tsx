import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AdminPageWidth = 'wide' | 'default' | 'narrow'

const widthClassMap: Record<AdminPageWidth, string> = {
  wide: 'max-w-[1320px]',
  default: 'max-w-[1120px]',
  narrow: 'max-w-[900px]'
}

interface AdminPageShellProps {
  children: ReactNode
  className?: string
  width?: AdminPageWidth
}

interface AdminPageHeaderProps {
  title: string
  description?: string
  eyebrow?: string
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
        'mx-auto w-full space-y-4',
        widthClassMap[width],
        className
      )}
    >
      {children}
    </section>
  )
}

export function AdminPageHeader({
  title,
  description,
  eyebrow,
  actions
}: AdminPageHeaderProps) {
  return (
    <header className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
        'rounded-xl border border-border bg-card p-4 shadow-sm',
        className
      )}
    >
      {children}
    </section>
  )
}
