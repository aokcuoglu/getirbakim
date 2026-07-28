'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SlidersHorizontal } from 'lucide-react'

interface AdminFilterChipProps {
  label: string
  active?: boolean
  onClick: () => void
  /** Etiketin tek başına anlatamadığı filtre semantiği için hover açıklaması. */
  title?: string
}

export function AdminFilterChip({ label, active, onClick, title }: AdminFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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

interface AdminFilterSelectChipOption {
  value: string
  label: string
}

interface AdminFilterSelectChipProps {
  /** Prefix label shown before the selected value, e.g. "Marka:". */
  prefix?: string
  value: string
  options: AdminFilterSelectChipOption[]
  onChange: (value: string) => void
  className?: string
}

/**
 * A compact dropdown chip that matches AdminFilterChip styling.
 * Renders inline within AdminFilterBar. Shows the selected option's label
 * (or a placeholder) and opens a lightweight popover for selection.
 */
export function AdminFilterSelectChip({
  prefix,
  value,
  options,
  onChange,
  className
}: AdminFilterSelectChipProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selected = options.find((o) => o.value === value) ?? null
  const isActive = Boolean(selected) && value !== 'all'
  const displayLabel = selected?.label ?? 'Tümü'

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
          isActive
            ? 'border-foreground/20 bg-foreground text-background'
            : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        {isActive ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-background" />
        ) : null}
        {prefix ? <span className="opacity-70">{prefix}</span> : null}
        <span className="max-w-[140px] truncate">{displayLabel}</span>
        <ChevronDown
          className={cn('size-3 shrink-0 opacity-60', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                'block w-full truncate rounded-sm px-2 py-1.5 text-left text-xs',
                option.value === value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              title={option.label}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface AdminFilterBarProps {
  children?: React.ReactNode
  onReset?: () => void
  resetLabel?: string
  onRefresh?: () => void
  refreshLabel?: string
  className?: string
}

export function AdminFilterBar({
  children,
  onReset,
  resetLabel = 'Filtreleri Sıfırla',
  onRefresh,
  refreshLabel = 'Yenile',
  className
}: AdminFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {children}
      {onRefresh ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          {refreshLabel}
        </Button>
      ) : null}
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
