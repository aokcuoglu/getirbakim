'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminTableLoadingIndicatorProps {
  label?: string
  className?: string
}

export function AdminTableLoadingIndicator({
  label = 'Veriler güncelleniyor',
  className
}: AdminTableLoadingIndicatorProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-3 top-3 z-10',
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label}
      </div>
    </div>
  )
}
