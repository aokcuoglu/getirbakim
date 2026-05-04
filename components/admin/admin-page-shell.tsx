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
        'mx-auto w-full space-y-4 sm:space-y-5',
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
    <header className="rounded-2xl bg-gradient-to-r from-white via-indigo-50/30 to-white border border-indigo-100/50 px-4 py-5 shadow-lg shadow-indigo-100/50 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm text-slate-500">{description}</p>
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
        'rounded-2xl bg-white border border-slate-100 p-4 shadow-md shadow-slate-100/50 sm:p-6',
        className
      )}
    >
      {children}
    </section>
  )
}
