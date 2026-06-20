'use client'

import { Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AdminTableToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  isSearchLoading?: boolean
  onRefresh?: () => void
  isRefreshing?: boolean
  onAdvancedFilter?: () => void
  advancedFilterLabel?: string
  filters?: React.ReactNode
  className?: string
  showRefresh?: boolean
  actions?: React.ReactNode
}

export function AdminTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Ara...',
  isSearchLoading = false,
  onRefresh,
  isRefreshing = false,
  onAdvancedFilter,
  advancedFilterLabel = 'Daha Fazla Filtre',
  filters,
  className,
  showRefresh = true,
  actions
}: AdminTableToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between',
        className
      )}
    >
      <div className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 rounded-md border-border bg-background pl-9 pr-9 text-sm shadow-none"
          />
          {isSearchLoading ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {(showRefresh && onRefresh) || actions ? (
          <div className="admin-toolbar-actions flex items-center gap-2">
            {showRefresh && onRefresh ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="rounded-md border-border bg-background"
              >
                {isRefreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Yenile
              </Button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>

      <div className="admin-toolbar-actions flex flex-wrap items-center gap-2">
        {filters}
        {onAdvancedFilter ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdvancedFilter}
            className="rounded-md border-border/60 bg-card"
          >
            <Filter className="mr-2 h-4 w-4" />
            {advancedFilterLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
