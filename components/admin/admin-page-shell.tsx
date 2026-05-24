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
        'mx-auto w-full space-y-6',
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
    <header className="flex flex-col gap-1">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-sm text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
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
        'rounded-xl border bg-card p-6 text-card-foreground shadow-sm',
        className
      )}
    >
      {children}
    </section>
  )
}
