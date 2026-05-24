'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminTableShellProps {
  children: React.ReactNode
  isLoading?: boolean
  loadingLabel?: string
  className?: string
}

export function AdminTableShell({
  children,
  isLoading = false,
  loadingLabel = 'Veriler güncelleniyor',
  className
}: AdminTableShellProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-card shadow-sm',
        className
      )}
    >
      {isLoading ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end bg-background/60 p-3 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {loadingLabel}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  )
}
