'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SlidersHorizontal } from 'lucide-react'

interface AdminFilterChipProps {
  label: string
  active?: boolean
  onClick: () => void
}

export function AdminFilterChip({ label, active, onClick }: AdminFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-foreground/20 bg-foreground text-background'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {active ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-background" />
      ) : null}
      {label}
    </button>
  )
}

interface AdminFilterBarProps {
  children: React.ReactNode
  onReset?: () => void
  resetLabel?: string
  className?: string
}

export function AdminFilterBar({
  children,
  onReset,
  resetLabel = 'Filtreleri Sıfırla',
  className
}: AdminFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {children}
      {onReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onReset}
        >
          <SlidersHorizontal className="mr-1 h-3 w-3" />
          {resetLabel}
        </Button>
      ) : null}
    </div>
  )
}
